import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, get_db
from models import User
from routers import auth

class DeviceFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.engine=create_engine('sqlite:///'+str(Path(self.temp.name)/'oauth.db'))
        Base.metadata.create_all(self.engine)
        self.factory=sessionmaker(bind=self.engine)
        self.addCleanup(self.temp.cleanup);self.addCleanup(self.engine.dispose)
        self.calls=[]; self.provider_error=None; self.user_status=200
        self.app=FastAPI();self.app.include_router(auth.router)
        def db():
            with self.factory() as value: yield value
        self.app.dependency_overrides[get_db]=db
        owner=self
        class Client:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def request(self,method,url,**kwargs):
                owner.calls.append((method,url))
                if url.endswith('/login/device/code'):
                    return httpx.Response(200,json={'device_code':'synthetic-device','user_code':'TEST-CODE','verification_uri':'https://github.com/login/device','interval':5,'expires_in':900})
                if url.endswith('/login/oauth/access_token'):
                    return httpx.Response(200,json={'error':owner.provider_error} if owner.provider_error else {'access_token':'synthetic-github-token'})
                return httpx.Response(owner.user_status,json={'id':1001,'login':'test-user','name':'Test','email':'test@example.test'} if owner.user_status==200 else {'message':'Rejected'})
            def post(self,url,**kwargs):return self.request('POST',url,**kwargs)
            def get(self,url,**kwargs):return self.request('GET',url,**kwargs)
        self.patch=patch.object(auth,'httpx',SimpleNamespace(Client=lambda **_:Client(),HTTPError=httpx.HTTPError))
        self.patch.start();self.addCleanup(self.patch.stop)
        self.env=patch.dict('os.environ',{'GITHUB_CLIENT_ID':'synthetic-client'})
        self.env.start();self.addCleanup(self.env.stop)

    def post(self,path='/auth/github/device/poll',header=None):
        with TestClient(self.app) as client:
            return client.post(path,json={'device_code':'synthetic-device'},headers={'Authorization':header} if header else {})

    def test_invalid_link_session_fails_before_github_exchange(self):
        response=self.post(header='Bearer invalid-synthetic')
        self.assertEqual(response.status_code,401)
        self.assertEqual(self.calls,[])
        with self.factory() as db:self.assertEqual(db.query(User).count(),0)

    def test_existing_github_identity_cannot_be_stolen_by_link(self):
        with self.factory() as db:
            db.add_all([User(id='a',name='A',email='a@example.test',role='pm',password_hash='',github_id='1001'),User(id='b',name='B',email='b@example.test',role='pm',password_hash='')]);db.commit()
        token=auth._make_token('b','b@example.test','pm')
        response=self.post(header='Bearer '+token)
        self.assertEqual(response.status_code,409)
        with self.factory() as db:
            self.assertEqual(db.get(User,'a').github_id,'1001');self.assertIsNone(db.get(User,'b').github_id)

    def test_failed_github_user_lookup_creates_no_account(self):
        self.user_status=401
        response=self.post()
        self.assertEqual(response.status_code,502)
        with self.factory() as db:self.assertEqual(db.query(User).count(),0)

    def test_login_does_not_implicitly_merge_by_email(self):
        with self.factory() as db:
            db.add(User(id='a',name='A',email='test@example.test',role='pm',password_hash=''));db.commit()
        self.assertEqual(self.post().status_code,409)
        with self.factory() as db:self.assertIsNone(db.get(User,'a').github_id)

    def test_new_github_account_has_supported_role(self):
        response=self.post();self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['user']['role'],'software_engineer')
        with self.factory() as db:self.assertEqual(db.query(User).count(),1)

    def test_pending_slowdown_and_expiry_never_create_accounts(self):
        for error in ('authorization_pending','slow_down','expired_token','access_denied'):
            self.provider_error=error
            response=self.post();self.assertEqual(response.json()['error'],error)
        with self.factory() as db:self.assertEqual(db.query(User).count(),0)

    def test_start_uses_server_client_id_and_missing_configuration_is_503(self):
        self.assertEqual(self.post('/auth/github/device/start').status_code,200)
        with patch.dict('os.environ',{'GITHUB_CLIENT_ID':''}):
            self.assertEqual(self.post('/auth/github/device/start').status_code,503)
