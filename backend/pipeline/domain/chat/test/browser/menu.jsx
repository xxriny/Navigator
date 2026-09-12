// Actual product HomeScreen; synthetic chat only. No Cloud/GitHub/LLM requests.
import React from 'react';
import {createRoot} from 'react-dom/client';
import HomeScreen from '/src/components/HomeScreen.jsx';
import useAppStore from '/src/store/useAppStore.js';
import '/src/index.css';
const params = new URLSearchParams(location.search);
const zoom = Number(params.get('zoom') || 1);
document.documentElement.style.zoom = String(zoom);
useAppStore.setState({authToken:null,currentUser:{id:'layout-fixture',role:'pm'},
  isDarkMode:true,pipelineStatus:'idle',lastFollowups:[],
  chatHistory:params.get('empty') ? [] : Array.from({length:20},(_,i)=>({id:'fixture-'+i,role:i%2?'assistant':'user',content:'메뉴 위치 검증용 대화 '+i})),
  apiKey:'',githubToken:'',currentSessionId:null,serverSessionId:null});
createRoot(document.getElementById('root')).render(
  <main style={{height:`${100/zoom}vh`,display:'flex',flexDirection:'column'}}>
    <p style={{padding:8,fontSize:12,color:'white',background:'#334155'}}>메뉴 배치 검사 · 실제 HomeScreen / 임시 대화 · 외부 연동 없음 · 배율 {zoom}</p>
    <section style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><HomeScreen/></section>
  </main>);
