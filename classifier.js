/* Pure role-inference module. Never overwrites user-written notes or edges. */
(function(root){'use strict';
const GROUPS=[
 {id:'input', label:'入力解析・検証', icon:'⌕',color:'#3579ba',desc:'入力値の解析と妥当性検証'},
 {id:'sort',label:'ソート制御',icon:'▦',color:'#2563a9',desc:'戦略選択と並び替え'},
 {id:'execute',label:'操作実行',icon:'⇄',color:'#088579',desc:'データ構造の操作と実行'},
 {id:'history',label:'履歴・最適化',icon:'↺',color:'#8b5bc1',desc:'履歴の記録と最適化'},
 {id:'output',label:'出力・計測',icon:'↗',color:'#ae752b',desc:'結果の出力と集計'},
 {id:'lifecycle',label:'初期化・後始末',icon:'◉',color:'#687b91',desc:'初期化・解放・終了処理'},
 {id:'shared',label:'その他・共通',icon:'◇',color:'#8292a4',desc:'共通部品・分類保留'}
];
const TOKENS={
 input:[['parse',6],['token',6],['arg',4],['validate',6],['valid',4],['option',4],['number',2],['input',5]],
 sort:[['sort',7],['radix',8],['complex',5],['simple',4],['medium',4],['adaptive',5],['disorder',5],['normalize',4],['pivot',6],['strategy',6],['partition',6],['restore',4],['rank',3]],
 execute:[['execute',7],['apply',5],['stack',5],['rotate',6],['swap',6],['push',6],['op',1]],
 history:[['history',9],['optimize',8],['record',6],['cancel',6],['adjacent',5],['combine',5],['partner',4]],
 output:[['print',9],['output',8],['write',7],['bench',7],['count',2],['stat',5],['report',5],['display',5],['log',4]],
 lifecycle:[['init',7],['free',7],['destroy',7],['cleanup',8],['error',6],['exit',6],['allocate',5],['ctx',3],['context',4]]
};
const NAME_OVERRIDES=[[/^execute_op$/,'execute'],[/^apply_op$/,'execute'],[/^print_op$/,'output'],[/^record_op$/,'history'],[/^print_history$/,'output'],[/^count_history$/,'output'],[/^run_sort$/,'sort'],[/^main$/,'lifecycle']];
function tokens(str){return String(str||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)}
function infer(node){
 const name=String(node.name||'').replace(/\(.*$/,'').split('.').pop().toLowerCase();
 const file=(node.sourceFile||'').split('/').pop().replace(/\.(c|h|py)$/i,'').toLowerCase();
 const values=new Map(GROUPS.map(g=>[g.id,0])),clues=new Map(GROUPS.map(g=>[g.id,[]]));
 for(const [pattern,id] of NAME_OVERRIDES)if(pattern.test(name)){values.set(id,values.get(id)+18);clues.get(id).push('関数名 '+name)}
 for(const [role,terms] of Object.entries(TOKENS))for(const [term,weight] of terms){
  if(tokens(name).some(t=>t===term||t.startsWith(term))){values.set(role,values.get(role)+weight);clues.get(role).push('関数名 '+term)}
  if(tokens(file).some(t=>t===term||t.startsWith(term))){values.set(role,values.get(role)+Math.round(weight*1.15));clues.get(role).push('ファイル名 '+term)}
 }
 let best='shared',score=0,second=0;
 for(const [role,num] of values){if(num>score){second=score;score=num;best=role}else if(num>second)second=num}
 if(score<3){best='shared';score=0}
 const confidence=score>=12&&score-second>=6?'高':score>=7&&score-second>=3?'中':'低';
 return {group:best,confidence,evidence:(clues.get(best)||[]).slice(0,4),score};
}
function classification(node){const guess=infer(node),group=GROUPS.some(g=>g.id===node.roleOverride)?node.roleOverride:guess.group;return {...guess,group,confirmed:!!(node.roleOverride&&node.roleOverride===group)}}
function members(nodes){const r=new Map(GROUPS.map(g=>[g.id,[]]));for(const n of nodes)r.get(classification(n).group).push(n);return r}
function groupRelations(nodes,edges){const ids=new Map(nodes.map(n=>[n.id,classification(n).group])),map=new Map();for(const e of edges){if(e.kind==='state')continue;const a=ids.get(e.from),b=ids.get(e.to);if(!a||!b||a===b)continue;const k=a+'|'+b;map.set(k,{from:a,to:b,count:(map.get(k)?.count||0)+1})}return [...map.values()]}
function layoutLayers(items,edges){
 const ids=new Set(items.map(n=>n.id)),adj=new Map(items.map(n=>[n.id,[]]));
 for(const e of edges)if(ids.has(e.from)&&ids.has(e.to)&&e.from!==e.to)adj.get(e.from).push(e.to);
 let seq=0;const index=new Map(),low=new Map(),stack=[],on=new Set(),comps=[];
 function visit(v){index.set(v,seq);low.set(v,seq++);stack.push(v);on.add(v);for(const w of adj.get(v)){if(!index.has(w)){visit(w);low.set(v,Math.min(low.get(v),low.get(w)))}else if(on.has(w))low.set(v,Math.min(low.get(v),index.get(w)))}if(low.get(v)===index.get(v)){const part=[];let w;do{w=stack.pop();on.delete(w);part.push(w)}while(w!==v);comps.push(part)}}
 for(const n of items)if(!index.has(n.id))visit(n.id);
 const which=new Map();comps.forEach((c,i)=>c.forEach(id=>which.set(id,i)));
 const next=new Map(comps.map((_,i)=>[i,new Set()])),incoming=new Map(comps.map((_,i)=>[i,0]));
 for(const [from,targets] of adj)for(const to of targets){const a=which.get(from),b=which.get(to);if(a!==b&&!next.get(a).has(b)){next.get(a).add(b);incoming.set(b,incoming.get(b)+1)}}
 const q=[...incoming].filter(([k,v])=>!v).map(([k])=>k),level=new Map(comps.map((_,i)=>[i,0]));
 for(let k=0;k<q.length;k++){const a=q[k];for(const b of next.get(a)){level.set(b,Math.max(level.get(b),level.get(a)+1));incoming.set(b,incoming.get(b)-1);if(incoming.get(b)===0)q.push(b)}}
 const lanes=new Map();for(const n of items){const l=Math.min(7,level.get(which.get(n.id))||0);if(!lanes.has(l))lanes.set(l,[]);lanes.get(l).push(n)}
 const sorted=[...lanes].sort((a,b)=>a[0]-b[0]);for(const [,arr] of sorted)arr.sort((a,b)=>(adj.get(b.id)||[]).length-(adj.get(a.id)||[]).length||String(a.name).localeCompare(String(b.name)));
 return sorted;
}
root.FCClassifier={GROUPS,infer,classification,members,groupRelations,layoutLayers};
})(typeof window!=='undefined'?window:globalThis);
