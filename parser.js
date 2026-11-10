/* Function Canvas parser: conservative, browser-only static analysis.
 * Contract: parseSources([{path,text}], language) => {definitions, calls, unresolved}
 * This is intentionally not a compiler or a complete Python AST implementation.
 */
(function(root){'use strict';
const C_KEYWORDS = new Set(['if','for','while','switch','return','sizeof','_Alignof','_Generic','do','case','else','typedef','struct','union','enum','defined','__attribute__','__asm__','_Static_assert']);
const PY_KEYWORDS = new Set(['if','elif','while','for','with','except','return','yield','assert','raise','lambda','class','def','async','await','not','and','or','in','is','printcall']);
function blankKeepLine(s){return s.replace(/[^\r\n]/g,' ')}
function maskC(src){
  let out='',mode='normal',escaped=false;
  for(let i=0;i<src.length;i++){
    const c=src[i],n=src[i+1];
    if(mode==='normal'){
      if(c==='/'&&n==='/'){out+='  ';i++;mode='line';continue}
      if(c==='/'&&n==='*'){out+='  ';i++;mode='block';continue}
      if(c==='"'||c==="'"){out+=' ';mode=c;escaped=false;continue}
      out+=c;
    }else if(mode==='line'){
      if(c==='\n'){out+='\n';mode='normal'}else out+=' ';
    }else if(mode==='block'){
      if(c==='*'&&n==='/'){out+='  ';i++;mode='normal'}
      else out+=c==='\n'?'\n':' ';
    }else{
      if(c==='\n'&&!escaped){out+='\n';mode='normal';continue}
      out+=c==='\n'?'\n':' ';
      if(escaped)escaped=false;
      else if(c==='\\')escaped=true;
      else if(c===mode)mode='normal';
    }
  }
  return out.replace(/^[ \t]*#[^\n]*/gm,m=>blankKeepLine(m));
}
function maskPython(src){
  let out='',mode='',escape=false;
  for(let i=0;i<src.length;i++){
    const c=src[i];
    if(!mode){
      if(c==='#'){mode='#';out+=' ';continue}
      if(c==='"'||c==="'"){
        if(src.slice(i,i+3)===c.repeat(3)){mode=c.repeat(3);out+='   ';i+=2}
        else {mode=c;out+=' '}
        escape=false;continue;
      }
      out+=c;continue;
    }
    if(mode==='#'){
      if(c==='\n'){mode='';out+='\n'}else out+=' ';
      continue;
    }
    if(mode.length===3&&src.slice(i,i+3)===mode&&!escape){out+='   ';i+=2;mode='';continue}
    out+=c==='\n'?'\n':' ';
    if(escape){escape=false;continue}
    if(c==='\\'){escape=true;continue}
    if(mode.length===1&&c===mode)mode='';
  }
  return out;
}
function lineOf(src,index){return 1+(src.slice(0,index).match(/\n/g)||[]).length}
function parseC(path,text){
  const masked=maskC(text),defs=[];
  let lastBoundary=0;
  for(let i=0;i<masked.length;i++){
    const c=masked[i];
    if(c===';'||c==='}')lastBoundary=i+1;
    if(c!=='{')continue;
    const raw=masked.slice(lastBoundary,i),header=raw.trim();
    const close=header.lastIndexOf(')');
    let name='',params='',matchHeader=false,isStatic=false;
    if(close>=0&&/^\s*$/.test(header.slice(close+1))){
      let depth=0,open=-1;
      for(let j=close;j>=0;j--){if(header[j]===')')depth++;else if(header[j]==='('&&--depth===0){open=j;break}}
      if(open>=0){
        const before=header.slice(0,open),m=before.match(/([A-Za-z_]\w*)\s*$/);
        if(m){name=m[1];params=header.slice(open+1,close).replace(/\s+/g,' ').trim();
          const prefix=before.slice(0,m.index).trim();
          matchHeader=!!prefix&&!/[=]/.test(prefix)&&!/\b(typedef|return|if|while|for|switch)\b/.test(prefix)&&!C_KEYWORDS.has(name)&&!/^#/.test(prefix);isStatic=matchHeader&&/\bstatic\b/.test(prefix);
        }
      }
    }
    if(!matchHeader){
      let depth=1;while(++i<masked.length&&depth){if(masked[i]==='{')depth++;else if(masked[i]==='}')depth--}
      lastBoundary=i+1;continue;
    }
    let depth=1,j=i;
    while(++j<masked.length&&depth){if(masked[j]==='{')depth++;else if(masked[j]==='}')depth--}
    if(depth){lastBoundary=j;break}
    const headerIndex=masked.lastIndexOf(name+'(',i); // only used as fallback
    const sourceStart=Math.max(0,lastBoundary+(raw.search(/\S/)<0?0:raw.search(/\S/)));
    const functionStart=Math.max(sourceStart,raw.lastIndexOf('\n')>=0&&raw.trimStart().startsWith('#')?headerIndex:sourceStart);
    const bodyStart=i+1,bodyEnd=j-1;
    const body=masked.slice(bodyStart,bodyEnd),calls=[];
    const callRegex=/\b([A-Za-z_]\w*)\s*\(/g;let cm;
    while((cm=callRegex.exec(body))!==null){
      if(C_KEYWORDS.has(cm[1]))continue;
      // Parenthesized type casts are filtered later as unresolved candidates.
      calls.push({name:cm[1],line:lineOf(text,bodyStart+cm.index)});
    }
    const line=lineOf(text,functionStart),endLine=lineOf(text,j);
    defs.push({path,language:'c',name,qualName:name,parameters:params,isStatic,
      line,endLine,source:text.slice(functionStart,j+1),calls});
    i=j;lastBoundary=j+1;
  }
  return defs;
}
function pyIndent(s){let count=0;for(const c of s){if(c===' ')count++;else if(c==='\t')count+=8-count%8;else break}return count}
function parsePython(path,text){
  const lines=text.split('\n'),masked=maskPython(text).split('\n');
  const definitions=[],scopes=[];
  let active=null;
  function endActive(at){if(active){active.endLine=at;active.source=lines.slice(active.line-1,at).join('\n');active=null}}
  for(let i=0;i<masked.length;i++){
    const line=masked[i],trim=line.trim(),indent=pyIndent(line);
    if(!trim)continue;
    while(scopes.length&&indent<=scopes[scopes.length-1].indent){
      const prev=scopes.pop();if(prev.type==='def'){prev.def.endLine=i;prev.def.source=lines.slice(prev.def.line-1,i).join('\n')}
    }
    const klass=trim.match(/^class\s+([A-Za-z_]\w*)\b[^:]*:/);
    if(klass){scopes.push({type:'class',name:klass[1],indent});continue}
    const fn=trim.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if(fn){
      const parents=scopes.map(s=>s.name),name=fn[1],qualName=[...parents,name].join('.');
      let sig=lines[i].trim();let endSig=i;
      while(!sig.includes(':')&&endSig<lines.length-1&&endSig-i<16){endSig++;sig+=' '+lines[endSig].trim()}
      const args=sig.slice(sig.indexOf('(')+1,sig.lastIndexOf(')')).trim();
      const def={path,language:'py',name,qualName,parameters:args,line:i+1,endLine:i+1,source:'',calls:[],scope:parents.join('.')};
      definitions.push(def);scopes.push({type:'def',name,indent,def});continue;
    }
    const current=[...scopes].reverse().find(s=>s.type==='def');
    if(!current)continue;
    const target=current.def,regex=/\b(?:(self|cls|[A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*\(/g;
    let cm;
    while((cm=regex.exec(line))!==null){if(PY_KEYWORDS.has(cm[2]))continue;
      target.calls.push({name:cm[2],receiver:cm[1]||'',line:i+1});
    }
  }
  while(scopes.length){const prev=scopes.pop();if(prev.type==='def'){prev.def.endLine=lines.length;prev.def.source=lines.slice(prev.def.line-1).join('\n')}}
  return definitions;
}
function resolveCall(def,call,defs,language){
  const names=defs.filter(x=>x.name===call.name),sameFile=names.filter(x=>x.path===def.path);
  if(language==='py'){
    if(call.receiver==='self'||call.receiver==='cls'){
      const className=def.qualName.split('.').slice(0,-1).join('.');
      const local=names.filter(x=>x.path===def.path&&x.qualName===className+'.'+call.name);
      return local.length===1?{target:local[0]}:{reason:'メソッドの定義を特定できません'};
    }
    if(call.receiver){
      const match=names.filter(x=>x.path===def.path&&x.qualName===call.receiver+'.'+call.name);
      if(match.length===1)return {target:match[0]};
      return {reason:'属性・外部モジュール呼び出し（静的に未解決）'};
    }
    const scope=def.qualName.split('.').slice(0,-1).join('.');
    const lexical=names.filter(x=>x.path===def.path&&(x.qualName===scope+'.'+call.name||x.qualName===call.name));
    if(lexical.length===1)return {target:lexical[0]};
    const moduleCandidate=names.filter(x=>x.path===def.path&&x.qualName===call.name);
    if(moduleCandidate.length===1)return {target:moduleCandidate[0]};
  }else if(sameFile.length===1)return {target:sameFile[0]};
  if(names.length===1)return {target:names[0]};
  return {reason:names.length>1?'同名の定義が複数あり特定不能':'外部関数・未提供の定義・マクロの可能性'};
}
function parseSources(sources,language){
  const defs=[];for(const file of sources){
    if(language==='c'&&/\.(?:c|h)$/i.test(file.path))defs.push(...parseC(file.path,file.text));
    else if(language==='py'&&/\.py$/i.test(file.path))defs.push(...parsePython(file.path,file.text));
  }
  const seen=new Map();for(const def of defs){const basic=language+':'+def.path+':'+def.qualName;
    const count=seen.get(basic)||0;seen.set(basic,count+1);def.key=basic+(count?':'+count:'');
  }
  const links=[],unresolved=[];const keyPairs=new Set();
  for(const def of defs){
    for(const call of def.calls){
      const match=resolveCall(def,call,defs,language);
      if(match.target){const k=def.key+'::'+match.target.key;
        if(!keyPairs.has(k)){keyPairs.add(k);links.push({fromKey:def.key,toKey:match.target.key})}
      }else unresolved.push({fromKey:def.key,caller:def.qualName,path:def.path,line:call.line,
        target:(call.receiver?call.receiver+'.':'')+call.name,reason:match.reason});
    }
  }
  return {definitions:defs,links,unresolved};
}
root.FCParser={parseSources,maskC,maskPython};
})(typeof window!=='undefined'?window:globalThis);
