import React from 'react';
import {createRoot} from 'react-dom/client';
import useAppStore from '/src/store/useAppStore';
import MemoManager from '/src/components/resultViewer/MemoManager';
import TaskApprovalPanel from '/src/components/resultViewer/TaskApprovalPanel';
import '/src/index.css';
const session=await (await fetch('/__test/session')).json();
useAppStore.setState({authToken:session.token,currentUser:session.user,userRole:'pm',currentSessionId:'browser-local',serverSessionId:'browser-project',sessions:[{id:'browser-local',serverSessionId:'browser-project',name:'Browser project'}],userComments:[],memoProposals:[],resultData:session.result,isDarkMode:true,backendPort:8897});
function Fixture(){const [state,setState]=React.useState(null);
 return <main className="bg-slate-950 text-white min-h-screen"><aside className="p-3 border-b flex gap-3 flex-wrap">
  <strong>격리된 브라우저 검증 · 실제 사용자 데이터 없음</strong>
  <button onClick={async()=>{const proposal=await (await fetch('/__test/memo-proposal',{method:'POST',headers:{Authorization:`Bearer ${session.token}`}})).json();useAppStore.setState({memoProposals:[proposal]});}}>메모 후보 준비</button>
  <button onClick={async()=>setState(await (await fetch('/__test/state')).json())}>테스트 DB 확인</button>
  <button onClick={async()=>{await fetch('/__test/conflict',{method:'POST'});setState({message:'동시 수정 주입 완료'});}}>동시 수정 재현</button>
  {state&&<pre className="w-full whitespace-pre-wrap" data-testid="db-state">{JSON.stringify(state,null,2)}</pre>}
 </aside><TaskApprovalPanel/><MemoManager/></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
