import unittest
from unittest.mock import AsyncMock, Mock, MagicMock, patch
from orchestration import pipeline_runner as runner


class MemoRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_model_candidates_are_never_automatically_committed(self):
        database = MagicMock()
        database.__enter__.return_value = database
        database.query.return_value.filter.return_value.all.return_value = []
        with patch.object(runner, '_run_pipeline_base', new=AsyncMock(return_value={
                'agent_reply': 'Saved', 'notes_to_add': [{'text': 'Unapproved'}]})), \
             patch('auth.deps.get_current_user_optional', return_value=Mock(id='owner')), \
             patch('pipeline.domain.chat.memo_approval.authorize_session'), \
             patch.object(runner, 'get_idea_pipeline'), \
             patch.object(runner, 'get_idea_chat_routing_map'), \
             patch.object(runner, 'SessionLocal', return_value=database), \
             patch('auth.database.SharedSessionLocal', return_value=database), \
             patch.object(runner.manager, 'send_json', new=AsyncMock()) as send:
            await runner.run_idea_chat(Mock(), {'message': 'Explain only', 'session_id': 'session'})
        database.add.assert_not_called()
        database.commit.assert_not_called()
        self.assertEqual(send.call_args.args[1]['data']['notes_to_add'], [])


if __name__ == '__main__':
    unittest.main()
