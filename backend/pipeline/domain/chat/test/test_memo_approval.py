import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException
from auth.models import AnalysisSession, MemoItem
from auth.shared_models import TeamMember
from pipeline.domain.agile.approval_store import ProposalStore, ProposalError
from pipeline.domain.chat import memo_approval as service


class MemoApprovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + str(Path(self.temp.name) / 'test.db'))
        for table in (AnalysisSession.__table__, MemoItem.__table__, TeamMember.__table__):
            table.create(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.db, self.shared = self.factory(), self.factory()
        self.addCleanup(self.cleanup)
        self.user = SimpleNamespace(id='owner')
        self.db.add(AnalysisSession(run_id='session', created_by='owner'))
        self.db.commit()
        self.clock = [1000.0]
        self.store = ProposalStore(clock=lambda: self.clock[0])
        self.patcher = patch.object(service, 'proposal_store', self.store)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def cleanup(self):
        self.db.close()
        self.shared.close()
        self.engine.dispose()
        self.temp.cleanup()

    def issue(self):
        return service.issue_memo_proposal(self.db, self.shared, self.user, 'session', [
            {'text': 'First', 'detail': ' Exact content\n', 'approved': True}, {'text': 'Second'}])

    def approve(self, entry, ids=None, user=None):
        return service.process_memo_proposal(self.db, self.shared, user or self.user,
            entry['proposal_id'], ids or [entry['items'][0]['item_id']])

    def test_issue_is_read_only_and_selected_exact_content_commits_once(self):
        entry = self.issue()
        self.assertEqual(self.db.query(MemoItem).count(), 0)
        self.assertEqual(entry['state'], 'pending')
        result = self.approve(entry)
        self.assertEqual(result['created'], 1)
        self.assertTrue(result['memos'][0]['id'])
        self.assertEqual(result['memos'][0]['detail'], ' Exact content\n')
        self.assertEqual(self.approve(entry), result)
        self.assertEqual(self.db.query(MemoItem).count(), 1)

    def test_wrong_actor_selection_expiry_and_cancellation_never_write(self):
        entry = self.issue()
        with self.assertRaises(ProposalError):
            self.approve(entry, user=SimpleNamespace(id='attacker'))
        with self.assertRaises(ProposalError):
            self.approve(entry, ids=['forged-id'])
        service.process_memo_proposal(self.db, self.shared, self.user, entry['proposal_id'], cancel=True)
        with self.assertRaises(ProposalError):
            self.approve(entry)
        entry = self.issue()
        self.clock[0] += 901
        with self.assertRaises(ProposalError):
            self.approve(entry)
        self.assertEqual(self.db.query(MemoItem).count(), 0)

    def test_changed_project_ownership_is_rechecked(self):
        entry = self.issue()
        self.db.get(AnalysisSession, 'session').created_by = 'another'
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            self.approve(entry)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(self.db.query(MemoItem).count(), 0)

    def test_commit_failure_rolls_back_and_does_not_allow_blind_retry(self):
        entry = self.issue()
        with patch.object(self.db, 'commit', side_effect=RuntimeError('injected commit failure')):
            with self.assertRaises(RuntimeError):
                self.approve(entry)
        self.assertEqual(self.db.query(MemoItem).count(), 0)
        with self.assertRaises(ProposalError):
            self.approve(entry)

    def test_duplicate_in_selected_batch_rolls_back_new_items(self):
        entry = self.issue()
        self.db.add(MemoItem(session_id='session', text='Second', section='Idea Chat', detail=''))
        self.db.commit()
        with self.assertRaises(HTTPException):
            self.approve(entry, ids=[i['item_id'] for i in entry['items']])
        self.assertEqual([r.text for r in self.db.query(MemoItem).all()], ['Second'])

    def test_team_membership_removed_after_review_is_rejected(self):
        self.db.get(AnalysisSession, 'session').team_id = 'team'
        self.db.add(TeamMember(id='membership', user_id='owner', team_id='team', role='backend'))
        self.db.commit()
        entry = self.issue()
        self.shared.query(TeamMember).delete()
        self.shared.commit()
        with self.assertRaises(HTTPException):
            self.approve(entry)
        self.assertEqual(self.db.query(MemoItem).count(), 0)

    def test_returned_review_payload_cannot_mutate_server_candidate(self):
        entry = self.issue()
        entry['items'][0]['content']['text'] = 'Tampered'
        result = self.approve(entry)
        self.assertEqual(result['memos'][0]['text'], 'First')


    def test_http_requires_auth_and_rejects_client_content_override(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from auth.deps import get_current_user
        from auth.database import get_db, get_shared_db
        from transport.rest_handler import rest_router
        app = FastAPI()
        app.include_router(rest_router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_shared_db] = lambda: self.shared
        entry = self.issue()
        endpoint = '/api/memo-proposals/' + entry['proposal_id'] + '/approve'
        with TestClient(app) as client:
            self.assertEqual(client.post(endpoint, json={'selected_ids': []}).status_code, 401)
            app.dependency_overrides[get_current_user] = lambda: self.user
            selected = [entry['items'][0]['item_id']]
            self.assertEqual(client.post(endpoint, json={
                'selected_ids': selected, 'text': 'Injected replacement', 'approved': True}).status_code, 422)
            response = client.post(endpoint, json={'selected_ids': selected})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['data']['memos'][0]['text'], 'First')
        self.assertEqual(self.db.query(MemoItem).count(), 1)


    def test_legacy_memo_routes_require_authentication(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from auth.database import get_db, get_shared_db
        from transport.rest_handler import rest_router
        app = FastAPI()
        app.include_router(rest_router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_shared_db] = lambda: self.shared
        with patch('auth.database.get_db', side_effect=lambda: iter([self.db])), TestClient(app) as client:
            for method, path, body in [
                ('post', '/api/memos', {'session_id': 'session', 'text': 'Unauthorized'}),
                ('get', '/api/memos?session_id=session', None),
                ('delete', '/api/memos/missing', None),
                ('post', '/api/memos/apply', {'memo_ids': []}),
            ]:
                with self.subTest(method=method, path=path):
                    response = client.request(method, path, **({'json': body} if body is not None else {}))
                    self.assertEqual(response.status_code, 401)


    def test_manual_memo_routes_check_ownership_and_preserve_normal_save(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from auth.deps import get_current_user
        from auth.database import get_db, get_shared_db
        from transport.rest_handler import rest_router
        app = FastAPI()
        app.include_router(rest_router)
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_shared_db] = lambda: self.shared
        self.db.add(AnalysisSession(run_id='foreign', created_by='another'))
        self.db.add(MemoItem(id='foreign-memo', session_id='foreign', text='Private'))
        self.db.commit()
        with TestClient(app, raise_server_exceptions=False) as client:
            self.assertEqual(client.get('/api/memos?session_id=foreign').status_code, 403)
            self.assertEqual(client.post('/api/memos', json={'session_id': 'foreign', 'text': 'Inject'}).status_code, 403)
            self.assertEqual(client.delete('/api/memos/foreign-memo').status_code, 403)
            response = client.post('/api/memos', json={'session_id': 'session', 'text': ' Exact note '})
            self.assertEqual(response.status_code, 200, response.text)
            own_id = response.json()['memo_id']
            self.assertEqual(client.post('/api/memos/apply', json={'memo_ids': [own_id, 'foreign-memo']}).status_code, 403)
            self.assertFalse(self.db.get(MemoItem, own_id).applied)
            self.assertEqual(client.post('/api/memos/apply', json={'memo_ids': [own_id]}).status_code, 200)
            self.assertTrue(self.db.get(MemoItem, own_id).applied)
            self.assertEqual(client.get('/api/memos?session_id=session').json()['memos'][0]['text'], ' Exact note ')
            self.assertEqual(client.delete('/api/memos/' + own_id).status_code, 200)
            with patch.object(self.db, 'commit', side_effect=RuntimeError('commit failure')):
                self.assertEqual(client.post('/api/memos', json={'session_id': 'session', 'text': 'Failed'}).status_code, 500)
            self.assertEqual(self.db.query(MemoItem).filter_by(session_id='session').count(), 0)


if __name__ == '__main__':
    unittest.main()
