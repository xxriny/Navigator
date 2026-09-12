import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function setup() {
  let now = 1000, state = {}, respond = async () => ({});
  const calls = [];
  const context = vm.createContext({URL, Date:{now:()=>now}, localStorage:{getItem:()=>null,setItem(){},removeItem(){}}});
  const exports = {EMPTY_RESULT_FIELDS:{},loadSessions:()=>[],SERVER_URL:'http://fixture',
    serverRequest:async(path, options)=>{calls.push(path);return respond(path, options);}};
  const helpers = new vm.SyntheticModule(Object.keys(exports), function(){
    for(const [key,value] of Object.entries(exports))this.setExport(key,value);
  },{context});
  const module = new vm.SourceTextModule(await readFile('src/store/slices/authSlice.js','utf8'),{context});
  await module.link(()=>helpers);await module.evaluate();
  const get=()=>state, set=update=>{state={...state,...(typeof update==='function'?update(state):update)};};
  state=module.namespace.createAuthSlice(set,get);
  const start={device_code:'synthetic-code',user_code:'TEST-CODE',verification_uri:'https://github.com/login/device',interval:5,expires_in:900};
  respond=async()=>start;
  return {get,set,calls,start,respond:fn=>{respond=fn;},advance:ms=>{now+=ms;}};
}
const success={access_token:'synthetic-app-token',user:{id:'account-a',role:'pm'}};

test('device success uses the response contract expected by the login UI',async()=>{
  const s=await setup();await s.get().startGithubDeviceFlow();s.advance(5000);s.respond(async()=>success);
  const result=await s.get().pollGithubDeviceFlow('synthetic-code');
  assert.equal(result.status,'ok');assert.equal(s.get().currentUser.id,'account-a');
});
test('cancelled in-flight device poll never logs in',async()=>{
  const s=await setup();await s.get().startGithubDeviceFlow();s.advance(5000);
  let finish;s.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=s.get().pollGithubDeviceFlow('synthetic-code');
  s.get().cancelGithubDeviceFlow();finish(success);await pending;
  assert.equal(s.get().authToken,null);
});
test('old device response cannot replace a newer account',async()=>{
  const s=await setup();await s.get().startGithubDeviceFlow();s.advance(5000);
  let finish;s.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=s.get().pollGithubDeviceFlow('synthetic-code');
  s.get().setAuth('synthetic-b',{id:'account-b'});finish(success);await pending;
  assert.equal(s.get().currentUser.id,'account-b');
});
test('polling honors initial interval, slowdown, terminal expiry and no overlap',async()=>{
  const s=await setup();await s.get().startGithubDeviceFlow();s.respond(async()=>({error:'slow_down'}));
  await s.get().pollGithubDeviceFlow('synthetic-code');assert.equal(s.calls.length,1);
  s.advance(5000);const slow=await s.get().pollGithubDeviceFlow('synthetic-code');assert.equal(slow.interval,10);
  s.advance(5000);await s.get().pollGithubDeviceFlow('synthetic-code');assert.equal(s.calls.length,2);
  s.advance(5000);let finish;s.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=s.get().pollGithubDeviceFlow('synthetic-code');
  await s.get().pollGithubDeviceFlow('synthetic-code');assert.equal(s.calls.length,3);
  finish({error:'expired_token'});assert.equal((await pending).status,'error');
  s.advance(10000);await s.get().pollGithubDeviceFlow('synthetic-code');assert.equal(s.calls.length,3);
});
test('device start rejects an unexpected verification destination',async()=>{
  const s=await setup();s.respond(async()=>({...s.start,verification_uri:'https://example.test/device'}));
  await assert.rejects(s.get().startGithubDeviceFlow());
});
test('link flow refuses a response for a different app account',async()=>{
  const s=await setup();s.get().setAuth('synthetic-b',{id:'account-b'});
  await s.get().startGithubDeviceFlow();s.advance(5000);s.respond(async()=>success);
  assert.equal((await s.get().pollGithubDeviceFlow('synthetic-code')).status,'error');
  assert.equal(s.get().currentUser.id,'account-b');
});
