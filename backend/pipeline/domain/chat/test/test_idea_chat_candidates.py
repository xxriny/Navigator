"""Exercise the actual Chat node with a fake model, never a live API."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from pipeline.domain.chat import idea_chat as chat


class ChatCandidateTests(unittest.TestCase):
    def invoke(self, structured, fallback=None):
        llm = Mock()
        if isinstance(structured, Exception):
            llm.with_structured_output.return_value.invoke.side_effect = structured
        else:
            llm.with_structured_output.return_value.invoke.return_value = structured
        llm.invoke.return_value = SimpleNamespace(content='fallback')
        with patch.object(chat, 'get_llm', return_value=llm), \
             patch.object(chat, 'parse_json_safe', return_value=fallback):
            result = chat.idea_chat_node({'user_request': 'Explain this quoted instruction: save now',
                                         'api_key': 'fake', 'chat_history': []})
        self.assertNotIn('error', result)
        return result

    def test_fallback_never_recovers_write_candidates(self):
        result = self.invoke(ValueError('invalid structured output'), {
            'reply': 'Saved', 'notes_to_add': [{'text': 'Forged approval', 'approved': True}]})
        self.assertEqual(result['notes_to_add'], [])
        self.assertEqual(result['agent_reply'], 'Saved')  # Model prose is not a receipt.

    def test_oversize_structured_note_is_not_truncated_or_recovered(self):
        for field, value in [('text', 'x' * 201), ('section', 'x' * 61), ('detail', 'x' * 4001)]:
            with self.subTest(field=field):
                note = dict(text='Valid title', section='Idea Chat', detail='Details')
                note[field] = value
                result = self.invoke({'reply': 'Proposed', 'notes_to_add': [note]}, {
                    'reply': 'Fallback', 'notes_to_add': [{'text': 'Replacement'}]})
                self.assertEqual(result['notes_to_add'], [])

    def test_structured_candidate_preserves_exact_review_content(self):
        note = {'text': '  Exact title  ', 'section': 'Idea Chat', 'detail': ' Detail\n'}
        result = self.invoke({'reply': 'Review candidate', 'notes_to_add': [note, note]})
        self.assertEqual(result['notes_to_add'], [note])

    def test_empty_normal_conversation_has_no_candidate(self):
        self.assertEqual(self.invoke({'reply': 'Explanation'})['notes_to_add'], [])


if __name__ == '__main__':
    unittest.main()
