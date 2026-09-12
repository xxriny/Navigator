import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function setup() {
  const services = { getProject: async () => ({ status: 'ok', data: { session_id: 'server-session' } }) };
  const context = vm.createContext({ console, Date, Math, Set, structuredClone, setTimeout, clearTimeout, localStorage: {getItem:()=>null,setItem(){},removeItem(){}} });
  const helpers = { SERVER_URL:'http://local',serverRequest:async()=>({}), loadSessions: () => [], persistSessions: () => {}, ownsLocalSession: (s,u) => !!u?.id && s?.owner_user_id === u.id && (s.team_id || null) === (u.team_id || null), cloneViewportTab: (v) => v,
    normalizeOutputTabId: (v) => v, extractRunId: (v) => v, spreadResultData: (v) => ({ resultData: v }),
    EMPTY_RESULT_FIELDS: {}, MODE_TO_ACTION_TYPE: {}, MODE_TO_PIPELINE_TYPE: {},
    inferPipelineTypeFromResult: () => 'analysis', normalizeMode: (v) => v };
  const linked = {};
  async function load(name) {
    const module = new vm.SourceTextModule(await readFile(`src/store/slices/${name}.js`, 'utf8'), { context });
    await module.link(async (specifier) => {
      if (!linked[specifier]) {
        const exports = specifier.includes('sessionService') ? { sessionService: services } : helpers;
        linked[specifier] = new vm.SyntheticModule(Object.keys(exports), function () {
          for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
      }
      return linked[specifier];
    });
    await module.evaluate();
    return module.namespace;
  }
  const session = await load('sessionSlice'), pipeline = await load('pipelineSlice'), auth = await load('authSlice');
  let state = {};
  const set = (update) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
  const get = () => state;
  state = { ...auth.createAuthSlice(set, get), ...session.createSessionSlice(set, get), ...pipeline.createPipelineSlice(set, get),
    backendPort: 8765, currentSessionId: 'session', serverSessionId: 'server-session', authToken: 'fake', currentUser: { id: 'owner' },
    addNotification() {}, addDebugLog() {} };
  return { get, set, services };
}

test('failed manual save never enters saved memo state', async () => {
  const { get, services } = await setup();
  services.addMemo = async () => { throw new Error('injected offline'); };
  await get().addComment({ text: 'Uncommitted' });
  assert.equal(get().userComments.length, 0);
});

test('pending save stays out of analysis input and success uses real ID', async () => {
  const { get, services } = await setup();
  let finish;
  services.addMemo = () => new Promise((resolve) => { finish = resolve; });
  const pending = get().addComment({ text: 'Reviewed' });
  await new Promise(setImmediate);
  assert.equal(get().userComments.length, 0);
  finish({ status: 'ok', memo_id: 'server-id' });
  await pending;
  assert.equal(get().userComments[0].id, 'server-id');
});

test('late save cannot write into a different project', async () => {
  const { get, set, services } = await setup();
  let finish;
  services.addMemo = () => new Promise((resolve) => { finish = resolve; });
  const pending = get().addComment({ text: 'Project A' });
  await new Promise(setImmediate);
  set({ currentSessionId: 'other', userComments: [] });
  finish({ status: 'ok', memo_id: 'server-id' });
  await pending;
  assert.equal(get().userComments.length, 0);
});

test('authoritative empty memo list removes stale local entries', async () => {
  const { get, set, services } = await setup();
  set({ userComments: [{ id: 'auto_stale', text: 'Unreviewed' }] });
  services.getMemos = async () => ({ status: 'ok', memos: [] });
  await get().syncMemos();
  assert.equal(get().userComments.length, 0);
});

test('advisor output never automatically becomes a memo', async () => {
  const { get } = await setup();
  get()._processResult({ recommendations: [{ action: 'Skip security', target: 'Auth', priority: 'high' }] });
  assert.equal(get().userComments.length, 0);
});


test('new local project receives server ID and memo uses that ID', async () => {
  const { get, set, services } = await setup();
  set({ serverSessionId: null, sessions: [{ id: 'session', name: 'Project' }] });
  services.createProject = async () => ({ status: 'ok', data: { session_id: 'registered-project' } });
  let target;
  services.addMemo = async (_port, body) => { target = body.session_id; return { status: 'ok', memo_id: 'saved' }; };
  await get().addComment({ text: 'Explicit note' });
  assert.equal(get().currentSessionId, 'session');
  assert.equal(get().serverSessionId, 'registered-project');
  assert.equal(target, 'registered-project');
});

test('old ownerless analysis is checked and never silently claimed', async () => {
  const { get, set, services } = await setup();
  set({ serverSessionId: null, resultData: { run_id: 'legacy-run' } });
  let creates = 0;
  services.getProject = async () => { throw new Error('ownership missing'); };
  services.createProject = async () => { creates++; };
  await assert.rejects(get().ensureServerSession());
  assert.equal(creates, 0);
});

test('auth changes clear memo inputs and proposals; parked memo rows never return',async()=>{
  const {get,set}=await setup();
  for(const change of [()=>get().clearAuth(),()=>get().setAuth('new',{id:'other'}),()=>get().setAuth('fake',{id:'owner',team_id:'other-team'})]){
    set({authToken:'fake',currentUser:{id:'owner'},userComments:[{id:'old',persisted:true}],memoProposals:[{proposal_id:'old'}]});
    change();assert.equal(get().userComments.length,0);assert.equal(get().memoProposals.length,0);
  }
  set({teamWorkspaces:{team:{currentSessionId:'session',serverSessionId:'project',userComments:[{id:'cached',persisted:true}]}}});
  get()._restoreWorkspace('team');assert.equal(get().userComments.length,0);assert.notEqual(get().serverSessionId,'project');
});
test('memo refresh reports failure and removes stale analysis inputs',async()=>{
  const {get,set,services}=await setup();set({userComments:[{id:'old',persisted:true}]});
  services.getMemos=async()=>{throw new Error('access denied');};
  assert.equal(await get().syncMemos(),false);assert.equal(get().userComments.length,0);
  services.getMemos=async()=>({status:'ok',memos:[]});assert.equal(await get().syncMemos(),true);
});
test('new project cannot inherit previous memo inputs',async()=>{
  const {get,set}=await setup();set({userComments:[{id:'old',persisted:true}],memoProposals:[{}]});
  get().createSession('New project');assert.equal(get().userComments.length,0);assert.equal(get().memoProposals.length,0);
});
test('manual memo save completing after team switch returns no UI success',async()=>{
  const {get,set,services}=await setup();let finish;const notifications=[];
  set({addNotification:(...args)=>notifications.push(args)});
  services.addMemo=()=>new Promise(r=>finish=r);const request=get().addComment({text:'old team'});
  await new Promise(setImmediate);set({currentUser:{id:'owner',team_id:'other'}});finish({status:'ok',memo_id:'saved'});
  assert.equal(await request,false);assert.equal(get().userComments.length,0);assert.equal(notifications.length,0);
});

test('project lookup cannot attach its response after team or server-project change',async()=>{
  for(const change of [()=>({currentUser:{id:'owner',team_id:'other'}}),()=>({serverSessionId:'different'})]){
    const {get,set,services}=await setup();let finish;
    services.getProject=()=>new Promise(r=>finish=r);
    const request=get().ensureServerSession();const rejected=assert.rejects(request,/변경/);
    set(change());finish({status:'ok',data:{session_id:'old-project'}});await rejected;
    assert.notEqual(get().serverSessionId,'old-project');
  }
});

// Account isolation acceptance cases (shared store implementation approval pending).
test('logout removes active private chat from the in-memory workspace', async () => {
  const { get, set } = await setup();
  set({ sessions: [{ id: 'private-a', owner_user_id: 'owner' }],
    currentSessionId: 'private-a', serverSessionId: 'project-a',
    chatHistory: [{ role: 'user', content: 'Private account A conversation' }],
    resultData: { private_marker: 'account-a-only' } });
  get().clearAuth();
  assert.equal(get().authToken, null);
  assert.equal(get().chatHistory.length, 0, 'Logged-out workspace still contains the previous private conversation');
  assert.equal(get().sessions.length, 0, 'Logged-out workspace still exposes private library entries');
  assert.equal(get().currentSessionId, null);
  assert.equal(get().serverSessionId, null);
  assert.equal(get().resultData, null);
});

test('switching accounts within the same team does not retain private chat', async () => {
  const { get, set } = await setup();
  set({ currentUser: { id: 'owner', team_id: 'shared-team' },
    sessions: [{ id: 'private-a', owner_user_id: 'owner', team_id: 'shared-team', visibility: 'private' }],
    chatHistory: [{ role: 'user', content: 'Private account A conversation' }],
    currentSessionId: 'private-a', serverSessionId: 'project-a' });
  get().setAuth('synthetic-account-b-token', { id: 'account-b', team_id: 'shared-team' });
  assert.equal(get().currentUser.id, 'account-b');
  assert.equal(get().chatHistory.length, 0, 'Sharing a team must not carry over an active private conversation');
  assert.equal(get().sessions.some(s => s.id === 'private-a'), false);
});

test('simultaneous project registration in one unchanged workspace shares one request', async () => {
  const { get, set, services } = await setup();
  set({ serverSessionId: null, resultData: null, sessions: [{ id: 'session', name: 'Project' }] });
  let calls = 0;
  let finish;
  services.createProject = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = get().ensureServerSession();
  const second = get().ensureServerSession();
  assert.equal(calls, 1);
  finish({ status: 'ok', data: { session_id: 'project-once' } });
  assert.deepEqual(await Promise.all([first, second]), ['project-once', 'project-once']);
  assert.equal(get().serverSessionId, 'project-once');
});
