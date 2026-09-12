"""Immutable final-document previews, independent of publishing and credentials.

This module neither authorizes nor writes. The future trusted approval handler
must bind a stored preview to actor/team, destination and revision, enforce expiry
and one-time execution, and pass exactly this markdown to the publisher. A plain
fingerprint is reproducible by clients and MUST NOT be accepted as authorization.
"""
from dataclasses import dataclass
import hashlib
import json


def _nonempty(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a string with content")


@dataclass(frozen=True)
class PublishCandidate:
    owner: str
    repo: str
    mode: str
    page_title: str
    markdown: str
    expected_revision: str = ""

    def __post_init__(self):
        for name in ("owner", "repo"):
            value = getattr(self, name)
            _nonempty(value, name)
            if value in {".", ".."} or any(c.isspace() or c in "/\\?#" or ord(c) < 32 for c in value):
                raise ValueError(f"{name} must be a single repository path segment")
        if self.mode not in ("wiki", "issue"):
            raise ValueError("mode must be wiki or issue")
        _nonempty(self.page_title, "page_title")
        _nonempty(self.markdown, "markdown")
        if not isinstance(self.expected_revision, str):
            raise ValueError("expected_revision must be a string")

    @property
    def fingerprint(self) -> str:
        payload = ["document.publish.v1", self.owner, self.repo, self.mode,
                   self.page_title, self.markdown, self.expected_revision]
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def prepare_publish_candidate(*, owner: str, repo: str, mode: str,
                              page_title: str, markdown: str,
                              expected_revision: str = "") -> PublishCandidate:
    """Freeze final markdown without regenerating it or touching GitHub.

    Empty revision is unresolved, not proof that the destination does not exist.
    Provider existence/version checks remain the approval handler's responsibility.
    """
    return PublishCandidate(owner, repo, mode, page_title, markdown, expected_revision)
