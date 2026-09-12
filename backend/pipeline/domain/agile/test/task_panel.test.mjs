import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'rolldown/utils';

// Execute the actual component and event handlers. Network and React scheduling
// are isolated; browser rendering is covered separately by the integration run.
const path = new URL('../../../../../src/components/resultViewer/TaskApprovalPanel.jsx', import.meta.url);
const compiled = transformSync(path.pathname, await readFile(path, 'utf8'), {lang: 'jsx', jsx: {runtime: 'classic'}});
assert.equal(compiled.errors.length, 0);
const task = (id='one', status='unassigned') => ({id, title: `Task ${id}`, description: 'Reviewed body',
  task_type: 'feature', status, team_id:'team', area:'backend', effort:'M', updated_at:'2026-09-08T00:00:00', payload:{}});
const ok = data => ({ok:true, status:200, json:async()=>({status:'ok', data})});
const denied = (status, detail) => ({ok:false, status, json:async()=>({detail})});
async function harness(fetcher) {
  const states=[], calls=[]; let cursor=0, tree;
  const store={authToken:'token', currentUser:{id:'pm',team_id:'team',name:'PM'},userRole:'pm',backendPort:8000};
  const React={
    createElement:(type,props,...children)=>({type,props:props||{},children}), Fragment:'fragment',
    useState(initial){const i=cursor++; if(!(i in states)) states[i]=typeof initial==='function'?initial():initial;
      return [states[i], value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){const [value]=this.useState({current:initial}); return value;},
    useEffect(){}, useCallback:fn=>fn, useMemo:fn=>fn(),
  };
  const useStore=fn=>fn(store); useStore.getState=()=>store;
  const context=vm.createContext({console,URLSearchParams,Set,Map,setTimeout,clearTimeout,
    fetch:async(url,options={})=>{calls.push({url,options}); return fetcher(url,options);}});
  const module=new vm.SourceTextModule(compiled.code,{context});
  await module.link(spec=>{
    let exports;
    if(spec==='react') exports={default:React,...React};
    else if(spec.endsWith('useAppStore')) exports={default:useStore};
    else if(spec.endsWith('apiClient')) exports={apiBaseUrl:()=>'http://local'};
    else if(spec.endsWith('serverClient')) exports={serverRequest:async()=>({members:[]})};
    else if(spec==='lucide-react') exports=Object.fromEntries(['ClipboardList','Check','X','Clock','Loader2','RefreshCw','ChevronDown','ChevronRight','AlertTriangle','CheckCircle','XCircle','Plus','Trash2','Sparkles','Users','GitPullRequest','CircleDot','Inbox','Pencil','Save','UserCheck','RotateCcw'].map(name=>[name,name]));
    else exports={default:spec};
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context});
  });
  await module.evaluate();
  const render=()=>{cursor=0;tree=module.namespace.default();return tree;};
  const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.children):node==null||typeof node==='boolean'?'':String(node);
  const nodes=(node=tree)=>Array.isArray(node)?node.flatMap(n=>nodes(n??[])):node&&typeof node==='object'?[node,...nodes(node.children??[])]:[];
  const button=(label)=>{const found=nodes().find(n=>n.type==='button'&&(typeof label==='function'?label(text(n)):text(n).trim()===label));assert.ok(found,`Missing button ${label}`);return found;};
  const click=async label=>{await button(label).props.onClick({stopPropagation(){}});render();};
  render();
  return {calls,store,render,nodes,text:()=>text(tree),click,button};
}

test('task list sends authenticated team request',async()=>{
  const h=await harness(()=>ok([task()])); await h.click('새로고침');
  assert.equal(h.calls[0].options.headers?.Authorization,'Bearer token');
  assert.match(h.calls[0].url,/team_id=team/);assert.match(h.text(),/Task one/);
});

test('edit retains reviewed version across polling and displays conflict without success',async()=>{
  let version='2026-09-08T00:00:00';
  const h=await harness((url,options)=>options.method==='PATCH'?denied(409,'다른 사용자가 수정했습니다'):ok([{...task(),updated_at:version}]));
  await h.click('새로고침');await h.click(t=>t.includes('Task one'));await h.click('편집');
  version='2026-09-08T00:05:00';await h.click('새로고침');await h.click('저장');
  const request=h.calls.find(c=>c.options.method==='PATCH');
  assert.equal(request.options.headers.Authorization,'Bearer token');
  assert.equal(JSON.parse(request.options.body).expected_updated_at,'2026-09-08T00:00:00');
  assert.match(h.text(),/다른 사용자가 수정했습니다/);assert.ok(h.button('저장'));
});

test('failed bulk deletion retains failed task and reports server error',async()=>{
  const h=await harness((url,options)=>options.method==='DELETE'?new URL(url).pathname.endsWith('/one')?ok({deleted:true}):denied(409,'보존할 기록입니다'):ok([task('one','completed'),task('two','completed')]));
  await h.click('새로고침');await h.click(t=>/^완료\s*\(2\)$/.test(t.trim()));await h.click('전체 선택');await h.click(t=>t.includes('선택 삭제'));
  assert.doesNotMatch(h.text(),/Task one/);assert.match(h.text(),/Task two/);assert.match(h.text(),/보존할 기록입니다/);
  assert.ok(h.calls.filter(c=>c.options.method==='DELETE').every(c=>c.options.headers.Authorization==='Bearer token'));
  assert.ok(h.calls.filter(c=>c.options.method==='DELETE').every(c=>new URL(c.url).searchParams.get('expected_updated_at')==='2026-09-08T00:00:00'));
});

test('delayed list response from old account does not populate current account',async()=>{
  let resolve;const h=await harness(()=>new Promise(r=>{resolve=r;}));
  const pending=h.click('새로고침');h.store.authToken='other';h.store.currentUser={id:'other',team_id:'other'};
  resolve(ok([task('private')]));await pending;assert.doesNotMatch(h.text(),/Task private/);
});

test('rejected and security records do not offer deletion',async()=>{
  const h=await harness(()=>ok([task('rejected','rejected'),{...task('security','completed'),payload:{security:{rule_id:'jwt_validation'}}}]));
  await h.click('새로고침');await h.click(t=>t.includes('Task rejected'));await h.click(t=>t.includes('Task security'));
  // Inspect text directly: no terminal action should invite a forbidden delete.
  assert.ok(!h.nodes().some(n=>n.type==='button'&&n.children.flat(Infinity).some(c=>typeof c==='string'&&c.trim()==='삭제')));
});
