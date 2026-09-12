import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transformSync} from 'rolldown/utils';

const source=await readFile(new URL('../../../../../src/components/resultViewer/TaskProposalReview.jsx',import.meta.url),'utf8');
const compiled=transformSync('TaskProposalReview.jsx',source,{lang:'jsx',jsx:{runtime:'classic'}});
assert.equal(compiled.errors.length,0);
const proposal=()=>({proposal_id:'assignment',kind:'task.assignment',actor_id:'pm',team_id:'team',session_id:'team',
  expires_at:Date.now()/1000+600,items:[{item_id:'chosen',content:{operation:'assign',task:{id:'task',title:'Exact title',description:'Exact body',area:'backend',updated_at:'version'},member:{id:'dev',name:'Developer',role:'backend'},reason:'Role match'}}]});
async function setup(fetcher,entry=proposal()){
  const state={authToken:'token',currentUser:{id:'pm',team_id:'team'},resultData:{run_id:'unrelated-analysis'}};
  let cursor=0,tree;const values=[],calls=[],done=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment',
    useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],v=>values[i]=typeof v==='function'?v(values[i]):v];}};
  const store={getState:()=>({...state,currentUser:{...state.currentUser}})};
  const context=vm.createContext({Date,console,fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}});
  const module=new vm.SourceTextModule(compiled.code,{context});
  await module.link(name=>{const exports=name==='react'?{default:React,...React}:name.endsWith('useAppStore')?{default:store}:{apiBaseUrl:()=>'http://local'};
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});});
  await module.evaluate();
  const render=()=>{cursor=0;tree=module.namespace.default({proposal:entry,onDone:message=>done.push(message)});};
  const walk=n=>Array.isArray(n)?n.flatMap(walk):n&&typeof n==='object'?[n,...walk(n.children??[])]:[];
  const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):n==null||typeof n==='boolean'?'':String(n);
  const buttons=()=>walk(tree).filter(n=>n.type==='button');
  render();return{state,calls,done,render,entry,text:()=>text(tree),
    select(){walk(tree).find(n=>n.type==='input').props.onChange({target:{checked:true}});render();},
    button(label){const button=buttons().find(n=>text(n).includes(label));assert.ok(button);return button;},
    async click(label){await this.button(label).props.onClick();render();}};
}
const success=()=>({ok:true,json:async()=>({status:'ok',data:{assigned:1}})});

test('assignment preview shows exact task/member and approval sends IDs only',async()=>{
  const h=await setup(success);assert.match(h.text(),/Exact body/);assert.match(h.text(),/Developer/);
  assert.ok(h.button('승인·배분').props.disabled);h.select();await h.click('승인·배분');
  assert.equal(h.calls[0].url,'http://local/api/assignment-proposals/assignment/approve');
  assert.deepEqual(JSON.parse(h.calls[0].options.body),{selected_ids:['chosen']});
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer token');assert.deepEqual(h.done,['배분 완료: 1개']);
});
test('conflict stays in review and never reports assignment success',async()=>{
  const h=await setup(()=>({ok:false,json:async()=>({detail:'태스크가 변경되었습니다.'})}));h.select();await h.click('승인·배분');
  assert.equal(h.done.length,0);assert.match(h.text(),/태스크가 변경되었습니다/);assert.match(h.text(),/Exact title/);
  assert.ok(h.button('승인·배분').props.disabled);await h.click('검토 닫기');assert.equal(h.calls.length,1);assert.match(h.done[0],/다시 생성/);
});
test('cancel and expiration do not issue approval writes',async()=>{
  const h=await setup(success);await h.click('제안 취소');assert.match(h.calls[0].url,/\/cancel$/);assert.equal(h.calls[0].options.body,undefined);
  const expired=await setup(success,{...proposal(),expires_at:1});expired.select();assert.ok(expired.button('승인·배분').props.disabled);
});
test('account switch before action or during response cannot show stale success',async()=>{
  const h=await setup(success);h.state.currentUser={id:'other',team_id:'team'};h.select();await h.click('승인·배분');assert.equal(h.calls.length,0);
  let resolve;const late=await setup(()=>new Promise(r=>resolve=r));late.select();const request=late.click('승인·배분');
  late.state.authToken='other';late.state.currentUser={id:'other',team_id:'other'};resolve(success());await request;assert.equal(late.done.length,0);
});
