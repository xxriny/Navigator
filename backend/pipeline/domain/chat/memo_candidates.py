"""Memo review candidates; no database access or approval authority.

Caller must provide the target from trusted application state, validate session
ownership and obtain explicit approval separately. A fingerprint only detects
content changes; it is public, reproducible, and never an authorization token.
"""
from dataclasses import dataclass
import hashlib
import json


def _text(value, name, limit=None, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ValueError(f"{name} must be a string with content")
    if limit is not None and len(value) > limit:
        raise ValueError(f"{name} exceeds {limit} characters")
    return value


def validate_memo_content(text, section="Idea Chat", detail="") -> dict:
    """Validate content independently of target binding; never grants approval."""
    return {
        "text": _text(text, "text", 200),
        "section": _text(section, "section", 60),
        "detail": _text(detail, "detail", 4000, allow_empty=True),
    }


@dataclass(frozen=True)
class MemoCandidate:
    session_id: str
    text: str
    section: str = "Idea Chat"
    detail: str = ""

    def __post_init__(self):
        _text(self.session_id, "session_id")
        validate_memo_content(self.text, self.section, self.detail)

    @property
    def fingerprint(self) -> str:
        payload = ["memo.create.v1", self.session_id, self.text, self.section, self.detail]
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def prepare_memo_candidates(raw_notes, session_id: str) -> tuple[MemoCandidate, ...]:
    """Validate an entire batch without truncating reviewed content.

    Only known content fields are projected from model output. Model-supplied
    approval, actor and target fields are ignored. Invalid items reject the batch.
    Unlike the legacy normalizer, this review-only interface requires dictionaries.
    """
    _text(session_id, "session_id")
    if not isinstance(raw_notes, list):
        raise ValueError("notes must be a list")
    candidates = []
    seen = set()
    for item in raw_notes:
        if not isinstance(item, dict):
            raise ValueError("each note must be an object")
        candidate = MemoCandidate(
            session_id=session_id,
            text=item.get("text"),
            section=item.get("section", "Idea Chat"),
            detail=item.get("detail", ""),
        )
        if candidate not in seen:
            seen.add(candidate)
            candidates.append(candidate)
    return tuple(candidates)
