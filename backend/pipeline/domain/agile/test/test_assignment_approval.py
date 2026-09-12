import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from auth.shared_models import User, TeamMember
from auth.deps import get_current_user
from auth.database import get_db, get_shared_db
from pipeline.domain.agile.task_coordinator import AgileTask
from pipeline.domain.agile.approval_store import ProposalStore, ProposalError
from pipeline.domain.agile.schemas import TaskDistributorOutput
from pipeline.domain.agile import assignment_approval as service
from pipeline.domain.agile.nodes import task_distributor as node
from transport.rest_handler import rest_router


class AssignmentApprovalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.engine=create_engine('sqlite:///'+(Path(self.temp.name)/'test.db').as_posix())
        for table in (User.__table__,TeamMember.__table__,AgileTask.__table__):table.create(self.engine)
        self.factory=sessionmaker(bind=self.engine)
        self.db,self.shared=self.factory(),self.factory();self.user=SimpleNamespace(id='pm')
        self.addCleanup(self.cleanup)
        self.db.add_all([User(id='dev',name='Developer',email='dev@example.test',password_hash='unused',role='frontend',team_id='other'),
            TeamMember(id='pm-member',user_id='pm',team_id='team',role='pm'),
            TeamMember(id='dev-member',user_id='dev',team_id='team',role='backend'),
            AgileTask(id='one',title='One',description='Exact body',task_type='feature',team_id='team',status='unassigned',area='backend'),
            AgileTask(id='two',title='Two',description='Second body',task_type='feature',team_id='team',status='unassigned',area='backend'),
            AgileTask(id='rejected',title='REJECTED_ATTACK',task_type='feature',team_id='team',status='rejected'),
            AgileTask(id='foreign',title='Foreign',task_type='feature',team_id='other',status='unassigned'),
            AgileTask(id='dev-gap',title='Dev GAP',task_type='dev_gap_approval',team_id='team',status='unassigned')])
        self.db.commit();self.now=100
        self.store=ProposalStore(ttl=60,clock=lambda:self.now)
        self.store_patch=patch.object(service,'proposal_store',self.store);self.store_patch.start();self.addCleanup(self.store_patch.stop)

    def cleanup(self):
        self.db.close();self.shared.close();self.engine.dispose();self.temp.cleanup()

    def output(self, ids=('one','two')):
        return SimpleNamespace(parsed=TaskDistributorOutput(assignments=[dict(task_id=i,assignee_name='Developer',reason='Role match') for i in ids]))

    def generate(self,ids=('one','two')):
        with patch.object(node,'call_structured',return_value=self.output(ids)) as model:
            result=service.generate_assignment_proposal(self.db,self.shared,self.user,'team','unused','fake')
            self.assertNotIn('REJECTED_ATTACK',model.call_args.kwargs['user_msg'])
            self.assertNotIn('Dev GAP',model.call_args.kwargs['user_msg'])
            return result['review_proposal']

    def approve(self,entry,ids=None,user=None):
        return service.process_assignment_proposal(self.db,self.shared,user or self.user,entry['proposal_id'],
            ids if ids is not None else [i['item_id'] for i in entry['items']])

    def test_generation_does_not_write_and_selected_approval_is_exact_and_idempotent(self):
        entry=self.generate();self.assertEqual(self.db.get(AgileTask,'one').status,'unassigned')
        self.assertEqual(entry['items'][0]['content']['member']['role'],'backend')
        ids=[entry['items'][0]['item_id']];result=self.approve(entry,ids)
        self.assertEqual(result['assigned'],1);self.assertEqual(self.approve(entry,ids),result)
        self.db.expire_all();row=self.db.get(AgileTask,'one')
        self.assertEqual((row.status,row.assignee,row.reviewed_by,row.description),('pending_approval','Developer','pm','Exact body'))
        self.assertEqual(self.db.get(AgileTask,'two').status,'unassigned')
        self.assertEqual(self.db.get(AgileTask,'rejected').status,'rejected')

    def test_invalid_model_ids_and_duplicate_assignments_reject_without_writes(self):
        for ids in [('foreign',),('rejected',),('dev-gap',),('missing',),('one','one')]:
            with self.subTest(ids=ids),self.assertRaises(ValueError):self.generate(ids)
        self.assertEqual(self.db.get(AgileTask,'one').status,'unassigned')

    def test_changed_second_task_rolls_back_entire_selected_batch(self):
        entry=self.generate();self.db.get(AgileTask,'two').description='Concurrent change';self.db.commit()
        with self.assertRaises(HTTPException) as error:self.approve(entry)
        self.assertEqual(error.exception.status_code,409);self.db.expire_all()
        self.assertEqual(self.db.get(AgileTask,'one').status,'unassigned')
        self.assertEqual(self.db.get(AgileTask,'two').description,'Concurrent change')

    def test_changed_member_role_and_removed_membership_block_approval(self):
        entry=self.generate();self.db.query(TeamMember).filter_by(id='dev-member').update({'role':'frontend'});self.db.commit()
        with self.assertRaises(HTTPException):self.approve(entry)
        self.db.query(TeamMember).filter_by(id='dev-member').update({'role':'backend'});self.db.commit()
        entry=self.generate();self.db.query(TeamMember).filter_by(id='dev-member').delete();self.db.commit()
        with self.assertRaises(HTTPException):self.approve(entry)
        self.assertEqual(self.db.get(AgileTask,'one').status,'unassigned')

    def test_actor_pm_role_and_target_team_are_rechecked(self):
        entry=self.generate()
        with self.assertRaises(ProposalError):self.approve(entry,user=SimpleNamespace(id='other'))
        self.db.query(TeamMember).filter_by(id='pm-member').update({'role':'backend'});self.db.commit();self.shared.rollback()
        with self.assertRaises(HTTPException):self.approve(entry)
        with patch.object(node,'call_structured') as model,self.assertRaises(HTTPException):
            service.generate_assignment_proposal(self.db,self.shared,self.user,'other','unused','fake')
        model.assert_not_called()

    def test_cancel_expiry_and_invalid_selection_do_not_assign(self):
        entry=self.generate()
        with self.assertRaises(ProposalError):self.approve(entry,['forged'])
        service.process_assignment_proposal(self.db,self.shared,self.user,entry['proposal_id'],cancel=True)
        with self.assertRaises(ProposalError):self.approve(entry)
        entry=self.generate();self.now+=61
        with self.assertRaises(ProposalError):self.approve(entry)
        self.assertEqual(self.db.get(AgileTask,'one').status,'unassigned')

    def test_commit_failure_rolls_back_and_prevents_blind_replay(self):
        entry=self.generate()
        with patch.object(self.db,'commit',side_effect=RuntimeError('commit failed')),self.assertRaises(RuntimeError):self.approve(entry)
        self.db.expire_all();self.assertEqual(self.db.get(AgileTask,'one').status,'unassigned')
        self.assertEqual(self.db.get(AgileTask,'two').status,'unassigned')
        with self.assertRaises(ProposalError):self.approve(entry)

    def test_model_call_cannot_mutate_authoritative_snapshot(self):
        def during_call(**kwargs):
            self.db.get(AgileTask,'two').title='Changed during model';self.db.commit()
            return self.output()
        with patch.object(node,'call_structured',side_effect=during_call),self.assertRaises(HTTPException):
            service.generate_assignment_proposal(self.db,self.shared,self.user,'team','unused','fake')
        self.assertEqual(self.db.get(AgileTask,'one').status,'unassigned')

    def test_http_flow_ignores_client_members_and_forbids_content_override(self):
        app=FastAPI();app.include_router(rest_router)
        app.dependency_overrides[get_current_user]=lambda:self.user
        app.dependency_overrides[get_db]=lambda:self.db
        app.dependency_overrides[get_shared_db]=lambda:self.shared
        with patch.object(node,'call_structured',return_value=self.output()),TestClient(app) as client:
            response=client.post('/api/agile/distribute-tasks',json={'team_id':'team','members':[{'name':'Attacker','role':'pm'}],'distributed_by':'forged'})
            self.assertEqual(response.status_code,200,response.text)
            entry=response.json()['data']['review_proposal'];base='/api/assignment-proposals/'+entry['proposal_id']
            ids=[i['item_id'] for i in entry['items']]
            self.assertEqual(client.post(base+'/approve',json={'selected_ids':ids,'assignee':'Attacker'}).status_code,422)
            response=client.post(base+'/approve',json={'selected_ids':ids})
            self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['data']['assigned'],2)
        self.db.expire_all();self.assertEqual(self.db.get(AgileTask,'one').reviewed_by,'pm')
        self.assertEqual(self.db.get(AgileTask,'one').assignee,'Developer')

    def test_approval_and_cancellation_require_authentication(self):
        app=FastAPI();app.include_router(rest_router)
        with TestClient(app) as client:
            for action in ['approve','cancel']:
                response=client.post('/api/assignment-proposals/forged/'+action,json={'selected_ids':['forged']})
                self.assertEqual(response.status_code,401)


if __name__=='__main__':unittest.main()
