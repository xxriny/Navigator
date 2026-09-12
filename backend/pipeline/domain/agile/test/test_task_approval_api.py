import unittest
from unittest.mock import Mock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from transport.rest_handler import rest_router


class TaskApprovalAPITests(unittest.TestCase):
    def test_generation_requires_authentication(self):
        app = FastAPI()
        app.include_router(rest_router)
        fake_db = Mock()
        fake_db.query.return_value.filter.return_value.first.return_value = None
        with patch('auth.database.SessionLocal', return_value=fake_db), TestClient(app) as client:
            response = client.post('/api/agile/generate-tasks', json={'run_id': 'session', 'team_id': 'team'})
        self.assertEqual(response.status_code, 401)


    def test_manual_task_routes_require_authentication(self):
        app = FastAPI(); app.include_router(rest_router)
        from pipeline.domain.agile import task_coordinator as coordinator
        with patch.object(coordinator, 'init_tasks_db'), \
             patch.object(coordinator, 'create_task', return_value={}), \
             patch.object(coordinator, 'list_tasks', return_value=[]), \
             patch.object(coordinator, 'get_task', return_value={'id': 'task', 'task_type': 'feature'}), \
             patch.object(coordinator, 'update_task_status', return_value={}), \
             patch.object(coordinator, 'delete_task', return_value=True), TestClient(app) as client:
            for method, path, body in [
                ('post', '/api/tasks', {'task_type': 'feature', 'title': 'Unapproved', 'team_id': 'team'}),
                ('get', '/api/tasks?team_id=team', None),
                ('patch', '/api/tasks/task', {'status': 'completed'}),
                ('delete', '/api/tasks/task', None),
            ]:
                with self.subTest(method=method):
                    response = client.request(method, path, **({'json': body} if body is not None else {}))
                    self.assertEqual(response.status_code, 401)


if __name__ == '__main__':
    unittest.main()
