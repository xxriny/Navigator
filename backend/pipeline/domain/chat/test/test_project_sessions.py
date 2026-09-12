import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, Mock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException, FastAPI
from fastapi.testclient import TestClient
from auth.models import AnalysisSession, AnalysisResult
from auth.shared_models import TeamMember
from auth.database import get_db, get_shared_db
from auth.deps import get_current_user
from transport.rest_handler import rest_router
from pipeline.domain.chat.project_sessions import create_project, persist_owned_result


class ProjectSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + str(Path(self.temp.name) / 'test.db'))
        for table in (AnalysisSession.__table__, AnalysisResult.__table__, TeamMember.__table__):
            table.create(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.db, self.shared = self.factory(), self.factory()
        self.user = SimpleNamespace(id='owner', role='pm')
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.db.close(); self.shared.close(); self.engine.dispose(); self.temp.cleanup()

    def test_project_and_analysis_use_separate_server_ids_with_verified_owner(self):
        project = create_project(self.db, self.shared, self.user, 'Project')
        result = persist_owned_result(self.db, self.shared, self.user, project['session_id'], 'run1',
                                      {'run_id': 'model-forged', 'project_session_id': 'foreign'})
        self.assertEqual(result['run_id'], 'run1')
        self.assertEqual(result['project_session_id'], project['session_id'])
        self.assertEqual(self.db.get(AnalysisSession, 'run1').created_by, 'owner')
        self.assertEqual(json.loads(self.db.get(AnalysisResult, 'run1').shaped_result), result)
        with self.assertRaises(HTTPException):
            persist_owned_result(self.db, self.shared, self.user, project['session_id'], 'run1', {})

    def test_orphan_and_foreign_projects_cannot_be_claimed(self):
        self.db.add_all([AnalysisSession(run_id='orphan'), AnalysisSession(run_id='foreign', created_by='another')])
        self.db.commit()
        for project_id in ('orphan', 'foreign'):
            with self.assertRaises(HTTPException):
                persist_owned_result(self.db, self.shared, self.user, project_id, 'new-run', {})
        self.assertEqual(self.db.query(AnalysisResult).count(), 0)
        self.assertIsNone(self.db.get(AnalysisSession, 'orphan').created_by)

    def test_team_registration_and_role_loss_are_checked(self):
        with self.assertRaises(HTTPException):
            create_project(self.db, self.shared, self.user, 'Wrong team', 'team')
        self.shared.add(TeamMember(user_id='owner', team_id='team', role='pm'))
        self.shared.commit()
        project = create_project(self.db, self.shared, self.user, 'Owned team', 'team')
        self.shared.query(TeamMember).update({'role': 'backend'}); self.shared.commit()
        with self.assertRaises(HTTPException):
            persist_owned_result(self.db, self.shared, self.user, project['session_id'], 'run1', {})
        self.assertEqual(self.db.query(AnalysisResult).count(), 0)

    def test_failed_result_commit_does_not_leave_orphan_run(self):
        project = create_project(self.db, self.shared, self.user, 'Project')
        with patch.object(self.db, 'commit', side_effect=RuntimeError('commit failed')):
            with self.assertRaises(RuntimeError):
                persist_owned_result(self.db, self.shared, self.user, project['session_id'], 'run1', {})
        self.assertIsNone(self.db.get(AnalysisSession, 'run1'))

    def test_http_registration_uses_server_id_and_ignores_no_owner_override(self):
        app = FastAPI(); app.include_router(rest_router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_shared_db] = lambda: self.shared
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/projects', json={}).status_code, 401)
            app.dependency_overrides[get_current_user] = lambda: self.user
            self.assertEqual(client.post('/api/projects', json={'created_by': 'foreign'}).status_code, 422)
            response = client.post('/api/projects', json={'title': 'Manual project'})
            self.assertEqual(response.status_code, 200, response.text)
            project_id = response.json()['data']['session_id']
            self.assertEqual(client.get('/api/projects/' + project_id).status_code, 200)


class RunnerPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_result_save_failure_emits_error_not_success(self):
        from orchestration import pipeline_runner as runner
        with patch.object(runner, 'stream_pipeline_updates', new=AsyncMock(return_value={'run_id': 'model'})), \
             patch.object(runner, 'shape_result', return_value={}), \
             patch.object(runner, '_persist_analysis_result', side_effect=RuntimeError('commit failed')), \
             patch.object(runner.manager, 'send_json', new=AsyncMock()) as send:
            result = await runner._run_pipeline_base(Mock(), pipeline=Mock(), routing={}, state_payload={},
                pipeline_type='analysis', persistence_context={'run_id': 'trusted', 'project_id': 'p', 'actor_id': 'u'})
        self.assertIn('error', result)
        self.assertEqual([call.args[1]['type'] for call in send.call_args_list], ['error'])


class OwnedAnalysisFlowTests(unittest.IsolatedAsyncioTestCase):
    setUp = ProjectSessionTests.setUp
    cleanup = ProjectSessionTests.cleanup

    async def test_full_runner_preserves_request_identity_and_commits_owned_result(self):
        from orchestration import pipeline_runner as runner
        self.user.github_oauth_token = None
        project = create_project(self.db, self.shared, self.user, 'Project')
        with patch.object(runner, 'SessionLocal', self.factory), \
             patch('auth.database.SharedSessionLocal', self.factory), \
             patch('auth.deps.get_current_user_optional', return_value=self.user), \
             patch.object(runner, 'get_user_by_id', return_value=self.user), \
             patch.object(runner, 'get_pm_pipeline'), patch.object(runner, 'get_sa_pipeline'), \
             patch.object(runner, 'stream_pipeline_updates', new=AsyncMock(side_effect=[
                 {'run_id': 'model-forged'}, {'run_id': 'model-forged'}])), \
             patch.object(runner, 'shape_result', return_value={'run_id': 'model-forged', 'project_session_id': 'foreign'}), \
             patch.object(runner.manager, 'send_json', new=AsyncMock()) as send:
            await runner.run_analysis(Mock(), {'idea': 'Build a project', 'auth_token': 'fake',
                                              'project_session_id': project['session_id']})
        frame = send.call_args.args[1]
        self.assertEqual(frame['type'], 'result')
        result = frame['data']
        self.assertNotEqual(result['run_id'], 'model-forged')
        self.assertEqual(result['project_session_id'], project['session_id'])
        row = self.db.get(AnalysisSession, result['run_id'])
        self.assertEqual(row.created_by, 'owner')
        self.assertIsNotNone(self.db.get(AnalysisResult, result['run_id']))
