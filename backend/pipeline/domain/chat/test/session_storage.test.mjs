import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
async function fixture() {
  const storage=new Map([['pm_sessions', JSON.stringify([{id:'legacy', chatHistory:['preserve']}])]]);
  const context=vm.createContext({localStorage:{getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v)}, console});
  const mod=new vm.SourceTextModule(await readFile('src/store/storeHelpers.js','utf8'), {context});
  await mod.link(()=>{});await mod.evaluate();return {api:mod.namespace,storage};
}
test('real storage helper isolates users and teams and preserves unknown legacy owner',async()=>{
  const {api,storage}=await fixture();const legacy=storage.get('pm_sessions');
  const a={id:'a',team_id:'team'},b={id:'b',team_id:'team'};
  api.persistSessions([{id:'private-a',owner_user_id:'a',team_id:'team'}],a);
  assert.equal(api.loadSessions(a).length,1);assert.equal(api.loadSessions(b).length,0);
  assert.equal(api.loadSessions({id:'a',team_id:'other'}).length,0);assert.equal(api.loadSessions().length,0);
  assert.equal(storage.get('pm_sessions'),legacy);
});
test('forged or ownerless cached entries never enter an authenticated library',async()=>{
  const {api,storage}=await fixture();const user={id:'a',team_id:'team'};
  storage.set(api.sessionStorageKey(user),JSON.stringify([{id:'other',owner_user_id:'b',team_id:'team'},{id:'unknown',team_id:'team'}]));
  assert.equal(api.loadSessions(user).length,0);
});
