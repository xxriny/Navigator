import unittest
from dataclasses import FrozenInstanceError
from pipeline.domain.agile.publish_candidates import prepare_publish_candidate

class PublishCandidateTests(unittest.TestCase):
    def make(self, **changes):
        args = dict(owner="team", repo="project", mode="wiki", page_title="Design", markdown="# Reviewed\nExact content", expected_revision="revision-1")
        args.update(changes)
        return prepare_publish_candidate(**args)

    def test_exact_markdown_is_frozen(self):
        candidate = self.make()
        self.assertEqual(candidate.markdown, "# Reviewed\nExact content")
        with self.assertRaises(FrozenInstanceError):
            candidate.markdown = "unreviewed"

    def test_all_reviewed_fields_are_bound(self):
        original = self.make()
        for field, value in dict(owner="other", repo="other", mode="issue", page_title="Other", markdown="Other content", expected_revision="revision-2").items():
            with self.subTest(field=field):
                self.assertNotEqual(original.fingerprint, self.make(**{field: value}).fingerprint)

    def test_invalid_modes_do_not_fall_back_to_wiki(self):
        for mode in ("unexpected", "", None):
            with self.assertRaises(ValueError):
                self.make(mode=mode)

    def test_missing_target_or_document_rejected(self):
        for field in ("owner", "repo", "page_title", "markdown"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.make(**{field: " "})

    def test_invalid_target_segments_rejected(self):
        for target in ("../other", "team/repo", "name\nheader"):
            with self.assertRaises(ValueError):
                self.make(owner=target)

    def test_fingerprint_is_deterministic_but_not_approval(self):
        self.assertEqual(self.make().fingerprint, self.make().fingerprint)
        self.assertFalse(hasattr(self.make(), "approved"))

if __name__ == "__main__":
    unittest.main()
