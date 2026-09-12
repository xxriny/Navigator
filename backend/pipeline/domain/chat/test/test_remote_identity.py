import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock, AsyncMock
import httpx
from fastapi import HTTPException, FastAPI
from fastapi.testclient import TestClient
from auth import remote_identity as remote
from auth.deps import get_current_user_optional
from auth.database import get_db, get_shared_db
from auth.models import AnalysisSession
from transport.rest_handler import rest_router
from pipeline.domain.chat.project_sessions import create_project
from pipeline.domain.chat.memo_approval import authorize_session
from pipeline.domain.chat.test import test_session_access_boundary as fixtures

class RemoteIdentityTests(unittest.TestCase):
    setUp = fixtures.SessionAccessBoundaryTests.setUp

    def service(self, mode='ok', teams=None):
        self.mode = mode
        self.teams = teams if teams is not None else [{'id':'team-a', 'role':'pm'}]
        self.paths = []
        def handle(request):
            self.paths.append(request.url.path)
            if self.mode == 'offline': raise httpx.ConnectError('offline', request=request)
            if self.mode == 'expired': return httpx.Response(401)
            if request.url.path == '/auth/me':
                return httpx.Response(200, json={'id':'account-a', 'email':'a@example.test', 'name':'A', 'role':'pm', 'team_id':'team-a'})
            return httpx.Response(200, json={'teams': self.teams})
        factory = lambda: httpx.Client(transport=httpx.MockTransport(handle))
        self.addCleanup(patch.stopall)
        patch.dict('os.environ', {'NAVIGATOR_AUTH_MODE':'remote'}).start()
        patch.object(remote, 'open_client', factory).start()

    def test_cloud_identity_registers_without_local_user_or_membership_copy(self):
        self.service()
        with self.factory() as db:
            user = get_current_user_optional(token='synthetic-cloud-token', db=db)
            project = create_project(db, db, user, 'Cloud project', 'team-a')
            self.assertEqual(project['created_by'], 'account-a')
            self.assertNotIn('synthetic-cloud-token', repr(user))
            # Only AnalysisSession/AnalysisResult/TeamMember exist in this fixture;
            # authentication succeeded without a users table or signing key.
            self.teams = []
            with self.assertRaises(HTTPException) as caught:
                authorize_session(db, db, user, project['session_id'])
            self.assertEqual(caught.exception.status_code, 403)

    def test_invalid_cloud_token_never_falls_back_to_local_decoder(self):
        self.service('expired')
        with self.factory() as db, patch('auth.deps.decode_token') as local:
            self.assertIsNone(get_current_user_optional(token='synthetic-expired', db=db))
            local.assert_not_called()

    def test_outage_and_malformed_memberships_fail_closed(self):
        self.service('offline')
        with self.factory() as db:
            with self.assertRaises(HTTPException) as caught:
                get_current_user_optional(token='synthetic', db=db)
            self.assertEqual(caught.exception.status_code, 503)
            self.mode = 'ok'
            user = get_current_user_optional(token='synthetic', db=db)
            self.teams = [{'id':'team-a', 'role':'admin-forged'}]
            with self.assertRaises(HTTPException) as caught:
                create_project(db, db, user, 'Denied', 'team-a')
            self.assertEqual(caught.exception.status_code, 503)
            self.assertEqual(db.query(AnalysisSession).filter_by(title='Denied').count(), 0)

    def test_rest_uses_cloud_bearer_and_reports_expiry_vs_outage(self):
        self.service()
        app=FastAPI(); app.include_router(rest_router)
        def database():
            with self.factory() as db: yield db
        app.dependency_overrides[get_db]=database
        app.dependency_overrides[get_shared_db]=database
        with TestClient(app) as client:
            headers={'Authorization':'Bearer synthetic'}
            self.assertEqual(client.post('/api/projects', headers=headers, json={'title':'HTTP','team_id':'team-a'}).status_code, 200)
            self.mode='expired'
            self.assertEqual(client.post('/api/projects', headers=headers, json={}).status_code, 401)
            self.mode='offline'
            self.assertEqual(client.post('/api/projects', headers=headers, json={}).status_code, 503)

class ChatEntryAuthenticationTests(unittest.IsolatedAsyncioTestCase):
    async def test_unauthenticated_websocket_chat_does_not_call_model(self):
        from orchestration import pipeline_runner as runner
        with patch.object(runner, '_run_pipeline_base', new=AsyncMock()) as model, patch.object(runner.manager, 'send_json', new=AsyncMock()) as send:
            await runner.run_idea_chat(Mock(), {'message':'Do something', 'session_id':'private'})
        model.assert_not_called()
        self.assertEqual(send.call_args.args[1]['type'], 'error')
