import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
from auth.database import get_db, get_shared_db
from auth.deps import get_current_user_optional
from auth.models import AnalysisSession
from transport.rest_handler import rest_router
from pipeline.domain.chat.test import test_session_access_boundary as fixtures

class ProjectIdempotencyTests(unittest.TestCase):
    setUp = fixtures.SessionAccessBoundaryTests.setUp

    def create(self, actor='account-a', title='Project', key='stable-local-session'):
        app = FastAPI(); app.include_router(rest_router)
        def database():
            with self.factory() as db:
                yield db
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_shared_db] = database
        app.dependency_overrides[get_current_user_optional] = lambda: SimpleNamespace(id=actor, role='pm')
        with TestClient(app) as client:
            return client.post('/api/projects', json={'title': title, 'client_request_id': key})

    def test_parallel_creation_and_retry_return_one_project(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.create(), range(2)))
        for response in results:
            self.assertEqual(response.status_code, 200, response.text)
        project_id = results[0].json()['data']['session_id']
        self.assertEqual(results[1].json()['data']['session_id'], project_id)
        self.assertEqual(self.create().json()['data']['session_id'], project_id)
        with self.factory() as db:
            self.assertEqual(db.query(AnalysisSession).filter_by(title='Project').count(), 1)

    def test_request_key_is_scoped_to_actor_and_changed_payload_conflicts(self):
        first, other = self.create(), self.create(actor='account-b')
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(other.status_code, 200, other.text)
        self.assertNotEqual(first.json()['data']['session_id'], other.json()['data']['session_id'])
        self.assertEqual(self.create(title='Changed').status_code, 409)
