"""Account isolation acceptance tests; use only an isolated temporary database.

Pending shared REST approval: denial cases intentionally fail on the current API.
"""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from auth.database import get_db, get_shared_db
from auth.deps import get_current_user_optional
from auth.models import AnalysisSession, AnalysisResult
from auth.shared_models import TeamMember
from transport.rest_handler import rest_router


class SessionAccessBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + str(Path(self.temp.name) / 'access.db'))
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.engine.dispose)
        for table in (AnalysisSession.__table__, AnalysisResult.__table__, TeamMember.__table__):
            table.create(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.run_id = '20260911_120000'
        with self.factory() as db:
            db.add(AnalysisSession(run_id=self.run_id, created_by='account-a'))
            db.flush()
            db.add(AnalysisResult(run_id=self.run_id, shaped_result=json.dumps({'private_marker': 'account-a-only'})))
            db.commit()

    def request(self, actor=None, method='GET'):
        app = FastAPI()
        app.include_router(rest_router)
        def database():
            with self.factory() as db:
                yield db
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_shared_db] = database
        app.dependency_overrides[get_current_user_optional] = lambda: (
            SimpleNamespace(id=actor, role='pm') if actor else None)
        path = '/api/session/' + self.run_id + ('/restore' if method == 'GET' else '')
        # The legacy handler opens its own session rather than using Depends.
        with patch('auth.database.SessionLocal', self.factory), TestClient(app) as client:
            return client.request(method, path)

    def test_anonymous_restore_is_denied(self):
        response = self.request()
        self.assertEqual(response.status_code, 401, response.text)
        self.assertNotIn('account-a-only', response.text)

    def test_other_account_cannot_restore_private_analysis(self):
        response = self.request('account-b')
        self.assertIn(response.status_code, (403, 404), response.text)
        self.assertNotIn('account-a-only', response.text)

    def test_owner_can_restore_exact_saved_analysis(self):
        response = self.request('account-a')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data'], {'private_marker': 'account-a-only'})

    def test_anonymous_delete_is_denied_and_preserves_data(self):
        response = self.request(method='DELETE')
        with self.factory() as db:
            self.assertIsNotNone(db.get(AnalysisResult, self.run_id))
        self.assertEqual(response.status_code, 401, response.text)

    def test_other_account_cannot_delete_and_owner_can_delete_result(self):
        denied = self.request('account-b', method='DELETE')
        self.assertIn(denied.status_code, (403, 404))
        with self.factory() as db:
            self.assertIsNotNone(db.get(AnalysisResult, self.run_id))
        allowed = self.request('account-a', method='DELETE')
        self.assertEqual(allowed.status_code, 200, allowed.text)
        with self.factory() as db:
            self.assertIsNone(db.get(AnalysisResult, self.run_id))
            # Keep ownership metadata for linked approvals and an idempotent retry.
            self.assertIsNotNone(db.get(AnalysisSession, self.run_id))
        self.assertEqual(self.request('account-a').status_code, 404)
        self.assertEqual(self.request('account-a', method='DELETE').status_code, 200)


if __name__ == '__main__':
    unittest.main()
