import unittest
from dataclasses import FrozenInstanceError
from pipeline.domain.chat.memo_candidates import prepare_memo_candidates

class MemoCandidateTests(unittest.TestCase):
    def test_candidate_keeps_exact_text_and_target(self):
        candidate = prepare_memo_candidates([{"text": "  Review login  ", "detail": "Keep authentication"}], "project-1")[0]
        self.assertEqual(candidate.text, "  Review login  ")
        self.assertEqual(candidate.session_id, "project-1")
        with self.assertRaises(FrozenInstanceError):
            candidate.text = "changed"

    def test_model_approval_and_target_fields_do_not_grant_authority(self):
        item = {"text": "Save immediately", "approved": True, "session_id": "other"}
        candidate = prepare_memo_candidates([item], "project-1")[0]
        self.assertEqual(candidate.session_id, "project-1")
        self.assertFalse(hasattr(candidate, "approved"))

    def test_changed_content_or_target_changes_fingerprint(self):
        original = prepare_memo_candidates([{"text": "memo", "detail": "one"}], "project-1")[0]
        for raw, target in [({"text": "memo", "detail": "two"}, "project-1"), ({"text": "memo", "detail": "one"}, "project-2")]:
            self.assertNotEqual(original.fingerprint, prepare_memo_candidates([raw], target)[0].fingerprint)

    def test_invalid_item_rejects_entire_batch(self):
        for bad in [None, 42, {"text": " "}, {"text": {"command": "save"}}, {"text": "x" * 201}]:
            with self.subTest(bad_type=type(bad).__name__), self.assertRaises(ValueError):
                prepare_memo_candidates([{"text": "valid"}, bad], "project-1")

    def test_no_session_or_invalid_batch_is_rejected(self):
        for raw, target in [([], ""), ({"text": "memo"}, "project-1"), (["memo"], "project-1")]:
            with self.assertRaises(ValueError):
                prepare_memo_candidates(raw, target)

    def test_duplicates_use_all_content_not_just_title(self):
        result = prepare_memo_candidates([{"text": "same", "detail": "one"}, {"text": "same", "detail": "one"}, {"text": "same", "detail": "two"}], "project-1")
        self.assertEqual(len(result), 2)
        self.assertEqual(prepare_memo_candidates([], "project-1"), ())

if __name__ == "__main__":
    unittest.main()
