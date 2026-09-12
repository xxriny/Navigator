import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transformSync} from 'rolldown/utils';

const source=await readFile(new URL('../../../../../src/components/resultViewer/MemoProposalReview.jsx',import.meta.url),'utf8');
const compiled=transformSync('MemoProposalReview.jsx',source,{lang:'jsx',jsx:{runtime:'classic'}});
assert.equal(compiled.errors.length,0);
const proposal=()=>({proposal_id:'memo',kind:'memo.create',actor_id:'pm',team_id:'team',session_id:'project',expires_at:Date.now()/1000+600,items:[{item_id:'chosen',content:{text:'Exact memo',section:'Idea Chat',detail:'Exact detail'}}]});
async function setup(fetcher,entry=proposal()){
  const notifications=[],syncs=[]; const state={authToken:'token',backendPort:8897,serverSessionId:'project',currentUser:{id:'pm',team_id:'team'},addNotification:(...args)=>notifications.push(args),syncMemos:async()=>{syncs.push(true);return true;}};
  let cursor=0,tree;const values=[],calls=[],done=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment',
    useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],v=>values[i]=typeof v==='function'?v(values[i]):v];}};
  const store={getState:()=>({...state,currentUser:{...state.currentUser}})};
  const context=vm.createContext({Date,console,fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}});
  const module=new vm.SourceTextModule(compiled.code,{context});
  await module.link(name=>{const exports=name==='react'?{default:React,...React}:name.endsWith('useAppStore')?{default:store}:{apiBaseUrl:()=>'http://local'};
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});});
  await module.evaluate();
  const render=()=>{cursor=0;tree=module.namespace.default({proposal:entry,onDismiss:id=>done.push(id)});};
  const walk=n=>Array.isArray(n)?n.flatMap(walk):n&&typeof n==='object'?[n,...walk(n.children??[])]:[];
  const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):n==null||typeof n==='boolean'?'':String(n);
  const buttons=()=>walk(tree).filter(n=>n.type==='button');
  render();return{state,calls,done,notifications,syncs,render,entry,text:()=>text(tree),
    select(){walk(tree).find(n=>n.type==='input').props.onChange({target:{checked:true}});render();},
    button(label){const button=buttons().find(n=>text(n).includes(label));assert.ok(button);return button;},
    async click(label){await this.button(label).props.onClick();render();}};
}
const success=()=>({ok:true,json:async()=>({status:'ok',data:{created:1}})});
test('memo review sends selected IDs only and reloads committed rows',async()=>{
  const h=await setup(success);assert.match(h.text(),/Exact memo/);assert.match(h.text(),/Exact detail/);
  assert.ok(h.button('건 저장').props.disabled);h.select();await h.click('건 저장');
  assert.equal(h.calls[0].url,'http://local/api/memo-proposals/memo/approve');
  assert.deepEqual(JSON.parse(h.calls[0].options.body),{selected_ids:['chosen']});
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer token');assert.equal(h.syncs.length,1);assert.equal(h.notifications.length,1);assert.deepEqual(h.done,['memo']);
});
test('uncertain memo write cannot be resubmitted; closing refreshes stored rows',async()=>{
  const h=await setup(()=>{throw new Error('Network failed');});h.select();await h.click('건 저장');
  assert.equal(h.done.length,0);assert.equal(h.notifications.length,0);assert.ok(h.button('건 저장').props.disabled);
  await h.click('검토 닫기');assert.equal(h.calls.length,1);assert.equal(h.syncs.length,1);assert.deepEqual(h.done,['memo']);
});
test('late approval success never updates a changed account, token, team or project',async()=>{
  for(const change of [s=>s.currentUser.id='other',s=>s.authToken='new-token',s=>s.currentUser.team_id='other-team',s=>s.serverSessionId='other-project']){
    let resolve;const h=await setup(()=>new Promise(r=>resolve=r));h.select();const request=h.click('건 저장');change(h.state);resolve(success());await request;
    assert.equal(h.notifications.length,0);assert.equal(h.syncs.length,0);assert.equal(h.done.length,0);
  }
});
test('changed account before approval, cancel and expiry do not approve',async()=>{
  const h=await setup(success);h.select();h.state.currentUser.id='other';await h.click('건 저장');assert.equal(h.calls.length,0);
  const cancel=await setup(success);await cancel.click('제안 취소');assert.match(cancel.calls[0].url,/\/cancel$/);assert.equal(cancel.calls[0].options.body,undefined);
  const expired=await setup(success,{...proposal(),expires_at:1});expired.select();assert.ok(expired.button('건 저장').props.disabled);
});

test('failed list refresh keeps review available without repeating an approval',async()=>{
  const h=await setup(()=>{throw new Error('Network failed');});h.select();await h.click('건 저장');
  h.state.syncMemos=async()=>false;await h.click('검토 닫기');
  assert.equal(h.done.length,0);assert.equal(h.calls.length,1);assert.match(h.text(),/목록/);
  h.state.syncMemos=async()=>true;await h.click('검토 닫기');assert.deepEqual(h.done,['memo']);assert.equal(h.calls.length,1);
});
