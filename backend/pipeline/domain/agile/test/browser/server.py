"""Loopback browser test fixture: temporary DB, real API/auth, deterministic models.
Run from backend. Never imports the main application or production database first.
"""
import json, os, secrets, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import uvicorn
temp = tempfile.TemporaryDirectory(prefix='navigator-agile-browser-')
os.environ['NAVIGATOR_STORAGE_DIR'] = temp.name
os.environ['NAVIGATOR_LOCAL_DATABASE_URL'] = 'sqlite:///' + (Path(temp.name)/'test.db').as_posix()
os.environ['NAVIGATOR_AUTH_MODE'] = 'local'
os.environ['NAVIGATOR_JWT_SECRET'] = secrets.token_hex(32)
os.environ['GEMINI_API_KEY'] = ''
sys.path.insert(0,str(Path(__file__).resolve().parents[5]))
from fastapi import FastAPI, Depends
from auth.database import engine, SessionLocal, get_shared_db
from auth.shared_models import User, TeamMember, Team
from auth.models import AnalysisSession, AnalysisResult, MemoItem
from auth.deps import get_current_user
from auth.service import create_access_token
from pipeline.domain.agile.task_coordinator import AgileTask, _task_to_dict
from pipeline.domain.agile.schemas import TaskDistributorOutput, TaskGeneratorOutput
from pipeline.domain.agile.nodes import task_distributor, task_generator
from transport.rest_handler import rest_router
for table in (Team.__table__,User.__table__,TeamMember.__table__,AnalysisSession.__table__,AnalysisResult.__table__,MemoItem.__table__,AgileTask.__table__):
    table.create(engine,checkfirst=True)
shaped={'run_id':'browser-run','project_session_id':'browser-project','pm_bundle':{'plan':{'requirements_rtm':[{'id':'FEAT_BROWSER','title':'Browser feature'}]}},'sa_arch_bundle':{}}
with SessionLocal() as db:
    db.add_all([Team(id='browser-team',name='Browser test team'),
        User(id='browser-pm',name='Test PM',email='pm@example.test',password_hash='unused',role='pm',team_id='browser-team'),
        User(id='browser-dev',name='Test Developer',email='dev@example.test',password_hash='unused',role='backend',team_id='browser-team'),
        TeamMember(user_id='browser-pm',team_id='browser-team',role='pm'),TeamMember(user_id='browser-dev',team_id='browser-team',role='backend'),
        AnalysisSession(run_id='browser-project',team_id='browser-team',created_by='browser-pm'),
        AnalysisSession(run_id='browser-run',team_id='browser-team',created_by='browser-pm'),
        AnalysisResult(run_id='browser-run',shaped_result=json.dumps(shaped)),
        AgileTask(id='task-one',title='API 입력 검증',description='승인한 요청 필드만 처리합니다.',task_type='feature',team_id='browser-team',status='unassigned',area='backend'),
        AgileTask(id='task-two',title='오류 응답 테스트',description='거부 응답과 저장 여부를 함께 검사합니다.',task_type='test',team_id='browser-team',status='unassigned',area='backend')])
    db.commit()
def distribution_model(**kwargs):
    with SessionLocal() as db:
        tasks=db.query(AgileTask).filter_by(team_id='browser-team',status='unassigned').all()
        return SimpleNamespace(parsed=TaskDistributorOutput(assignments=[dict(task_id=t.id,assignee_name='Test Developer',reason='백엔드 역할과 업무 범위를 확인한 제안') for t in tasks]))
def generation_model(**kwargs):
    return SimpleNamespace(parsed=TaskGeneratorOutput(tasks=[dict(task_type='feature',title='승인 후 생성되는 신규 기능',description='브라우저에서 검토한 본문입니다.',area='backend',priority='medium',effort='M',feature_ref='FEAT_BROWSER')],summary='신규 후보를 검토하세요.'))
app=FastAPI();app.include_router(rest_router)
@app.get('/__test/session')
def session():
    return {'token':create_access_token('browser-pm','pm@example.test','pm'),'user':{'id':'browser-pm','name':'Test PM','role':'pm','team_id':'browser-team'},'result':shaped}
@app.get('/__test/state')
def state():
    with SessionLocal() as db:return {'tasks':[_task_to_dict(t) for t in db.query(AgileTask).all()], 'memos':[dict(id=m.id,text=m.text,detail=m.detail,session_id=m.session_id) for m in db.query(MemoItem).all()]}
@app.post('/__test/memo-proposal')
def memo_proposal(user=Depends(get_current_user),shared_db=Depends(get_shared_db)):
    from pipeline.domain.chat.memo_approval import issue_memo_proposal
    with SessionLocal() as db:
        return issue_memo_proposal(db,shared_db,user,'browser-project',[
            {'text':'선택한 메모만 저장','section':'Idea Chat','detail':'이 본문을 변경 없이 저장합니다.'},
            {'text':'선택하지 않은 후보','section':'Idea Chat','detail':'자동으로 저장하면 안 됩니다.'}])
@app.post('/__test/conflict')
def conflict():
    with SessionLocal() as db:
        row=db.get(AgileTask,'task-two');row.description='다른 사용자가 변경한 최신 내용';db.commit()
    return {'changed':True}
@app.get('/auth/teams/{team_id}/members')
def members(team_id:str,user=Depends(get_current_user),db=Depends(get_shared_db)):
    from pipeline.domain.agile.manual_tasks import authorize_team
    authorize_team(db,user,team_id)
    return {'members':task_distributor._get_team_members(team_id,db)}
try:
    with patch.object(task_distributor,'call_structured',side_effect=distribution_model),patch.object(task_generator,'call_structured',side_effect=generation_model):
        uvicorn.run(app,host='127.0.0.1',port=8897,access_log=False)
finally:
    engine.dispose();temp.cleanup()
