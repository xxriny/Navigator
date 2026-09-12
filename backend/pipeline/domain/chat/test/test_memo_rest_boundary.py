import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from auth.database import get_db,get_shared_db
from auth.deps import get_current_user_optional
from auth.models import MemoItem
from transport import rest_handler as rest
from orchestration.executor import execute_pipeline
from pipeline.domain.chat.test import test_memo_approval as fixtures

class RestMemoBoundaryTests(unittest.TestCase):
    setUp=fixtures.MemoApprovalTests.setUp
    cleanup=fixtures.MemoApprovalTests.cleanup
    def request(self,user,session='session'):
        app=FastAPI();app.include_router(rest.rest_router)
        app.dependency_overrides[get_db]=lambda:self.db
        app.dependency_overrides[get_shared_db]=lambda:self.shared
        app.dependency_overrides[get_current_user_optional]=lambda:user
        pipeline=SimpleNamespace(invoke=lambda _:dict(agent_reply='Reply',notes_to_add=[dict(text='Candidate',detail='Exact detail')]))
        with patch.object(rest,'_ensure_pipeline'),patch.object(rest,'get_idea_pipeline',return_value=pipeline,create=True),patch.object(rest,'execute_pipeline',execute_pipeline,create=True),TestClient(app) as client:
            return client.post('/api/idea-chat',json={'message':'Discuss only','session_id':session}).json()
    def test_rest_chat_emits_review_not_legacy_saved_notes(self):
        data=self.request(self.user)['data']
        self.assertEqual(data['notes_to_add'],[])
        self.assertEqual(data['chat_reply'],'Reply')
        self.assertEqual(data['memo_proposal']['actor_id'],'owner')
        self.assertEqual(data['memo_proposal']['items'][0]['content']['detail'],'Exact detail')
        self.assertEqual(self.db.query(MemoItem).count(),0)
    def test_rest_chat_without_owner_returns_reply_without_write_authority(self):
        for user,session in [(None,'session'),(self.user,'foreign')]:
            data=self.request(user,session)['data']
            self.assertEqual(data['notes_to_add'],[])
            self.assertIsNone(data['memo_proposal'])
            self.assertTrue(data['memo_proposal_error'])
            self.assertEqual(self.db.query(MemoItem).count(),0)
