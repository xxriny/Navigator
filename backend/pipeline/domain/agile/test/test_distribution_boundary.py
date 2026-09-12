import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pipeline.domain.agile.nodes import task_distributor as node
from pipeline.domain.agile.schemas import TaskDistributorOutput
from transport.rest_handler import rest_router


class DistributionBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tasks=[dict(id='allowed',title='Task',description='Body',task_type='feature',team_id='team',
                         status='unassigned',area='backend',effort='M',feature_ref='',payload={},updated_at='2026-09-08T00:00:00')]
        self.members=[dict(id='dev',name='Developer',role='backend')]

    def run_node(self,task_id):
        output=TaskDistributorOutput(assignments=[dict(task_id=task_id,assignee_name='Developer',reason='Role match')])
        with patch.object(node,'list_tasks',return_value=self.tasks), patch.object(node,'call_structured',return_value=SimpleNamespace(parsed=output)), \
             patch('pipeline.domain.agile.task_coordinator.assign_task') as shared_write:
            # Capture the old local import as well as any use through the coordinator.
            with patch.object(node,'assign_task',shared_write,create=True):
                result=node.run_task_distributor('team','unused','fake',members=self.members)
                shared_write.assert_not_called()
                return result

    def test_normal_distribution_is_a_proposal_without_writes(self):
        result=self.run_node('allowed')
        self.assertEqual(result['assigned'],0)
        self.assertEqual(result['assignment_proposals'][0]['task_id'],'allowed')

    def test_model_cannot_assign_task_outside_snapshot(self):
        with self.assertRaises(ValueError): self.run_node('foreign')

    def test_rejected_body_and_payload_never_enter_distribution_prompt(self):
        rejected = dict(self.tasks[0], id='rejected', status='rejected',
                        title='REJECTED_TITLE_MARKER', description='REJECTED_BODY_MARKER',
                        assignee='Developer', payload={'instructions': 'REJECTED_PAYLOAD_MARKER'})
        output = TaskDistributorOutput(assignments=[dict(task_id='allowed', assignee_name='Developer', reason='Role match')])
        with patch.object(node, 'call_structured', return_value=SimpleNamespace(parsed=output)) as model:
            result = node.run_task_distributor('team', 'fake', 'fake', members=self.members, tasks=[*self.tasks, rejected])
        prompt = model.call_args.kwargs['user_msg']
        for marker in ('REJECTED_TITLE_MARKER', 'REJECTED_BODY_MARKER', 'REJECTED_PAYLOAD_MARKER'):
            self.assertNotIn(marker, prompt)
        self.assertEqual(node._get_current_workload('team', self.members, [rejected]), {'Developer': 0})
        self.assertEqual(result['assignment_proposals'][0]['task_id'], 'allowed')
        self.assertEqual(result['assigned'], 0)

    def test_distribution_endpoint_requires_authentication_before_model(self):
        app=FastAPI();app.include_router(rest_router)
        with patch.object(node,'run_task_distributor',return_value={'assigned':0}) as call,TestClient(app) as client:
            response=client.post('/api/agile/distribute-tasks',json={'team_id':'team','members':self.members,'distributed_by':'pm'})
            self.assertEqual(response.status_code,401)
            call.assert_not_called()


if __name__=='__main__': unittest.main()
