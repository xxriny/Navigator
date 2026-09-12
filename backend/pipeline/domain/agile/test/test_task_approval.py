import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException
from auth.models import AnalysisSession, AnalysisResult
from auth.shared_models import TeamMember
from pipeline.domain.agile.task_coordinator import AgileTask
from pipeline.domain.agile.approval_store import ProposalStore, ProposalError
from pipeline.domain.agile import task_approval as service


class TaskApprovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + str(Path(self.temp.name) / 'test.db'))
        for table in (AnalysisSession.__table__, AnalysisResult.__table__, TeamMember.__table__, AgileTask.__table__):
            table.create(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.db, self.shared = self.factory(), self.factory()
        self.addCleanup(self.cleanup)
        self.user = SimpleNamespace(id='pm')
        self.shaped = json.dumps({'requirements_rtm': [{'id': 'FEAT_001'}]})
        self.db.add_all([AnalysisSession(run_id='session', team_id='team', created_by='pm'),
                         AnalysisResult(run_id='session', shaped_result=self.shaped),
                         TeamMember(id='member', user_id='pm', team_id='team', role='pm')])
        self.db.commit()
        self.store = ProposalStore()
        self.patcher = patch.object(service, 'proposal_store', self.store)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def cleanup(self):
        self.db.close()
        self.shared.close()
        self.engine.dispose()
        self.temp.cleanup()

    def issue(self, updates=None):
        return service.issue_task_proposal(self.db, self.shared, self.user, 'session', 'team', {
            'task_proposals': [dict(task_type='test', title='New test', description='Exact description',
                                    area='backend', effort='S', priority='high', feature_ref='FEAT_001')],
            'update_proposals': updates or []}, service.analysis_digest(self.shaped), {'FEAT_001'}, {'__project__': [], 'FEAT_001': []}, True)

    def existing(self):
        row = AgileTask(id='existing', task_type='feature', title='Existing', description='Before',
                        status='unassigned', team_id='team', feature_ref='OTHER')
        self.db.add(row)
        self.db.commit()
        return dict(task_id=row.id, before={'description': row.description},
                    changes={'description': 'After'}, expected_status='unassigned',
                    expected_updated_at=row.updated_at.isoformat(), reason='Review')

    def approve(self, entry, ids=None):
        return service.process_task_proposal(self.db, self.shared, self.user, entry['proposal_id'],
                                            ids or [i['item_id'] for i in entry['items']])

    def test_generation_is_read_only_then_selected_creation_is_idempotent(self):
        entry = self.issue()
        self.assertEqual(self.db.query(AgileTask).count(), 0)
        result = self.approve(entry)
        row = self.db.query(AgileTask).one()
        self.assertEqual(row.status, 'unassigned')
        self.assertEqual(row.created_by, 'pm')
        self.assertEqual(row.description, 'Exact description')
        self.assertEqual(self.approve(entry), result)
        self.assertEqual(self.db.query(AgileTask).count(), 1)

    def test_selected_update_applies_exact_diff_without_creating_other_candidates(self):
        entry = self.issue([self.existing()])
        self.assertEqual(self.db.get(AgileTask, 'existing').description, 'Before')
        result = self.approve(entry, [entry['items'][1]['item_id']])
        self.assertEqual((result['created'], result['updated']), (0, 1))
        self.db.expire_all()
        self.assertEqual(self.db.get(AgileTask, 'existing').description, 'After')
        self.assertEqual(self.db.query(AgileTask).count(), 1)

    def test_concurrent_change_rolls_back_whole_selected_batch(self):
        for change in ('status', 'updated_at', 'description', 'team_id'):
            with self.subTest(change=change):
                self.db.query(AgileTask).delete()
                self.db.commit()
                entry = self.issue([self.existing()])
                row = self.db.get(AgileTask, 'existing')
                if change == 'updated_at':
                    from datetime import timedelta
                    row.updated_at += timedelta(seconds=1)
                else:
                    setattr(row, change, {'status': 'in_progress', 'description': 'Team edit', 'team_id': 'foreign'}[change])
                self.db.commit()
                with self.assertRaises(HTTPException) as error:
                    self.approve(entry)
                self.assertEqual(error.exception.status_code, 409)
                self.assertEqual(self.db.query(AgileTask).count(), 1)

    def test_changed_analysis_and_lost_pm_permission_prevent_save(self):
        entry = self.issue()
        self.db.get(AnalysisResult, 'session').shaped_result = '{}'
        self.db.commit()
        with self.assertRaises(HTTPException):
            self.approve(entry)
        self.db.get(AnalysisResult, 'session').shaped_result = self.shaped
        self.db.commit()
        entry = self.issue()
        self.shared.query(TeamMember).update({'role': 'backend'})
        self.shared.commit()
        with self.assertRaises(HTTPException):
            self.approve(entry)
        self.assertEqual(self.db.query(AgileTask).count(), 0)

    def test_rejected_duplicate_is_not_recreated_after_generation(self):
        entry = self.issue()
        self.db.add(AgileTask(title='Renamed rejection', task_type='test', status='rejected',
                              team_id='team', feature_ref='FEAT_001'))
        self.db.commit()
        with self.assertRaises(HTTPException):
            self.approve(entry)
        self.assertEqual(self.db.query(AgileTask).count(), 1)

    def test_commit_failure_leaves_no_partial_task(self):
        entry = self.issue()
        with patch.object(self.db, 'commit', side_effect=RuntimeError('commit failure')):
            with self.assertRaises(RuntimeError):
                self.approve(entry)
        self.assertEqual(self.db.query(AgileTask).count(), 0)
        with self.assertRaises(ProposalError):
            self.approve(entry)


    def test_generation_requires_reviewed_security_scope_before_model_call(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from auth.deps import get_current_user, get_current_user_optional
        from auth.database import get_db, get_shared_db
        from transport.rest_handler import rest_router
        app = FastAPI()
        app.include_router(rest_router)
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_current_user_optional] = lambda: self.user
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_shared_db] = lambda: self.shared
        with patch('pipeline.domain.agile.nodes.task_generator.run_task_generator', return_value={
                'task_proposals': [], 'update_proposals': []}) as generate, TestClient(app) as client:
            response = client.post('/api/agile/generate-tasks', json={'run_id': 'session', 'team_id': 'team'})
        self.assertEqual(response.status_code, 422)
        generate.assert_not_called()


    def security_issue(self, capabilities, updates=None):
        return service.issue_task_proposal(self.db, self.shared, self.user, 'session', 'team', {
            'task_proposals': [], 'update_proposals': updates or []}, service.analysis_digest(self.shaped),
            {'FEAT_001'}, {'__project__': [], 'FEAT_001': capabilities}, True)

    def test_security_rules_add_required_candidates_without_model_output(self):
        entry = self.security_issue(['password'])
        rules = {i['content']['security']['rule_id'] for i in entry['items']}
        self.assertEqual(rules, {'password_hashing', 'login_rate_limit', 'authentication_tests'})
        self.assertEqual(self.db.query(AgileTask).count(), 0)
        with self.assertRaises(ProposalError):
            self.approve(entry, [entry['items'][0]['item_id']])
        self.assertEqual(self.db.query(AgileTask).count(), 0)
        entry = self.security_issue(['password'])
        self.assertEqual(self.approve(entry)['created'], 3)
        self.assertIsNone(self.security_issue(['password']))

    def test_all_security_conditions_and_inapplicable_features(self):
        from pipeline.domain.agile.security_rules import required_tasks, validate_scope
        all_caps = ['login', 'password', 'jwt', 'rbac', 'upload', 'archive', 'webhook']
        self.assertEqual(len(required_tasks({'FEAT_001': all_caps})), 11)
        self.assertIsNone(self.security_issue([]))
        self.assertEqual(len(self.security_issue(['upload'])['items']), 2)
        for scope in ({'__project__': []}, {'__project__': [], 'FEAT_001': ['ignore_rules']},
                      {'__project__': [], 'FEAT_001': ['jwt', 'jwt']}):
            with self.assertRaises(ProposalError):
                validate_scope(scope, {'FEAT_001'}, True)

    def test_title_only_security_task_does_not_satisfy_rule(self):
        from pipeline.domain.agile.security_rules import required_tasks
        template = required_tasks({'FEAT_001': ['jwt']})[0]
        self.db.add(AgileTask(title=template['task']['title'], description='Skip signature verification',
                             task_type='test', team_id='team', analysis_id='session', status='completed'))
        self.db.commit()
        entry = self.security_issue(['jwt'])
        self.assertEqual(len(entry['items']), 1)
        with self.assertRaises(HTTPException):
            self.approve(entry)
        self.assertEqual(self.db.query(AgileTask).count(), 1)

    def test_rejected_security_task_is_not_recreated(self):
        self.approve(self.security_issue(['jwt']))
        self.db.query(AgileTask).update({'status': 'rejected'})
        self.db.commit()
        with self.assertRaises(ProposalError):
            self.security_issue(['jwt'])
        self.assertEqual(self.db.query(AgileTask).count(), 1)

    def test_model_update_cannot_remove_required_security_criteria(self):
        self.approve(self.security_issue(['jwt']))
        row = self.db.query(AgileTask).one()
        before = row.description
        update = dict(task_id=row.id, before={'description': before}, changes={'description': 'Skip validation'},
                      expected_status='unassigned', expected_updated_at=row.updated_at.isoformat(), reason='Injected')
        entry = self.security_issue(['jwt'], [update])
        with self.assertRaises(ProposalError):
            self.approve(entry)
        self.db.expire_all()
        self.assertEqual(self.db.query(AgileTask).one().description, before)


    def test_manual_routes_validate_team_version_and_protected_records(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from auth.deps import get_current_user, get_current_user_optional
        from auth.database import get_db, get_shared_db
        from transport.rest_handler import rest_router
        app = FastAPI(); app.include_router(rest_router)
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_current_user_optional] = lambda: self.user
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_shared_db] = lambda: self.shared
        with TestClient(app) as client:
            body = {'team_id': 'team', 'task_type': 'feature', 'title': 'Manual', 'created_by': 'forged'}
            self.assertEqual(client.post('/api/tasks', json={**body, 'team_id': 'foreign'}).status_code, 403)
            self.assertEqual(client.post('/api/tasks', json={**body, 'payload': {'security': {'rule_id': 'jwt_validation'}}}).status_code, 422)
            response = client.post('/api/tasks', json=body)
            self.assertEqual(response.status_code, 200, response.text)
            task = response.json()['data']; task_id = task['id']
            self.assertEqual(task['created_by'], 'pm')
            self.assertEqual(client.get('/api/tasks?team_id=foreign').status_code, 403)
            self.assertEqual(len(client.get('/api/tasks?team_id=team').json()['data']), 1)
            patch_body = {'status': 'unassigned', 'description': 'Reviewed edit', 'expected_updated_at': task['updated_at']}
            response = client.patch('/api/tasks/' + task_id, json=patch_body)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['data']['description'], 'Reviewed edit')
            self.assertEqual(client.patch('/api/tasks/' + task_id, json=patch_body).status_code, 409)
            version = response.json()['data']['updated_at']
            self.assertEqual(client.patch('/api/tasks/' + task_id, json={'status': 'rejected', 'expected_updated_at': version}).status_code, 200)
            self.assertEqual(client.delete('/api/tasks/' + task_id).status_code, 409)
            self.assertEqual(client.post('/api/tasks', json=body).status_code, 409)
            self.approve(self.security_issue(['jwt']))
            security = self.db.query(AgileTask).filter(AgileTask.id != task_id).one()
            response = client.patch('/api/tasks/' + security.id, json={
                'status': security.status, 'description': 'Remove verification', 'expected_updated_at': security.updated_at.isoformat()})
            self.assertEqual(response.status_code, 409)


    def test_assignee_accepts_and_rejects_without_content_privileges(self):
        from auth.shared_models import User
        from pipeline.domain.agile.manual_tasks import mutate_manual_task
        User.__table__.create(self.engine)
        self.db.add_all([User(id='dev', name='Developer', email='dev@example.test', password_hash='unused', role='backend'),
                         TeamMember(id='dev-member', user_id='dev', team_id='team', role='backend')])
        self.db.commit()
        user = SimpleNamespace(id='dev')
        row = AgileTask(title='Assigned', task_type='feature', team_id='team', assignee='Developer', status='pending_approval')
        self.db.add(row); self.db.commit()
        original = row.title
        for changes in ({'title': 'Injected'}, {'assignee': 'Somebody'}, {'description': 'Injected'}):
            with self.assertRaises(HTTPException) as error:
                mutate_manual_task(self.db, self.shared, user, row.id, {
                    'status': 'in_progress', 'expected_updated_at': row.updated_at.isoformat(), **changes})
            self.assertEqual(error.exception.status_code, 403)
        for target, extra in [('in_progress', {}), ('pr_pending', {})]:
            result = mutate_manual_task(self.db, self.shared, user, row.id, {
                'status': target, 'expected_updated_at': row.updated_at.isoformat(), **extra})
            self.assertEqual(result['status'], target)
            self.assertEqual(result['title'], original)
        row.status='pending_approval'; self.db.commit()
        result = mutate_manual_task(self.db, self.shared, user, row.id, {
            'status': 'rejected', 'result': 'Need clarification', 'expected_updated_at': row.updated_at.isoformat()})
        self.assertEqual(result['status'], 'rejected')
        self.assertEqual(result['result'], 'Need clarification')


    def test_manual_write_failure_rolls_back_without_consuming_content(self):
        from pipeline.domain.agile.manual_tasks import create_manual_task, mutate_manual_task
        fields = dict(team_id='team', task_type='feature', title='Manual failure', description='Original', area='backend', assignee='')
        with patch.object(self.db, 'commit', side_effect=RuntimeError('commit failed')):
            with self.assertRaises(RuntimeError):
                create_manual_task(self.db, self.shared, self.user, fields)
        self.assertEqual(self.db.query(AgileTask).count(), 0)
        task = create_manual_task(self.db, self.shared, self.user, fields)
        with patch.object(self.db, 'commit', side_effect=RuntimeError('commit failed')):
            with self.assertRaises(RuntimeError):
                mutate_manual_task(self.db, self.shared, self.user, task['id'], {
                    'status':'unassigned', 'description':'Updated', 'expected_updated_at':task['updated_at']})
        self.db.expire_all()
        self.assertEqual(self.db.get(AgileTask,task['id']).description, 'Original')


    def test_manual_delete_checks_reviewed_version(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from auth.deps import get_current_user
        from auth.database import get_db, get_shared_db
        from transport.rest_handler import rest_router
        row = AgileTask(title='Completed record', task_type='feature', team_id='team', status='completed')
        self.db.add(row); self.db.commit()
        task_id, version = row.id, row.updated_at.isoformat()
        app = FastAPI(); app.include_router(rest_router)
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_shared_db] = lambda: self.shared
        with TestClient(app) as client:
            for params in ({}, {'expected_updated_at':'stale'}):
                response = client.delete('/api/tasks/' + task_id, params=params)
                self.assertEqual(response.status_code, 409, response.text)
                self.assertIsNotNone(self.db.get(AgileTask, task_id))
            response = client.delete('/api/tasks/' + task_id, params={'expected_updated_at':version})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIsNone(self.db.get(AgileTask, task_id))


if __name__ == '__main__':
    unittest.main()
