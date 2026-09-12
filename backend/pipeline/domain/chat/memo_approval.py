"""Authorize review candidates and persist only explicitly selected memo contents."""
from fastapi import HTTPException
from auth.models import AnalysisSession, MemoItem
from auth.shared_models import TeamMember
from pipeline.domain.agile.approval_store import proposal_store, ProposalError
from pipeline.domain.chat.memo_candidates import prepare_memo_candidates


def authorize_session(db, shared_db, user, session_id, *, team_id=None, pm=False):
    if user is None:
        raise HTTPException(401, '로그인이 필요합니다.')
    from auth.remote_identity import refresh_user, membership
    user = refresh_user(user)
    session = db.get(AnalysisSession, session_id, populate_existing=True)
    if session is None:
        raise HTTPException(404, '프로젝트를 찾을 수 없습니다.')
    if team_id is not None and session.team_id != team_id:
        raise HTTPException(403, '프로젝트와 팀이 일치하지 않습니다.')
    if session.team_id:
        member = membership(shared_db, user, session.team_id)
        if member is None or (pm and member.role != 'pm'):
            raise HTTPException(403, '프로젝트 팀 권한이 없습니다.')
    elif session.created_by != user.id or pm:
        raise HTTPException(403, '프로젝트 소유권을 확인할 수 없습니다.')
    return session


def issue_memo_proposal(db, shared_db, user, session_id, raw_notes):
    session = authorize_session(db, shared_db, user, session_id)
    candidates = prepare_memo_candidates(raw_notes, session_id)
    if not candidates:
        return None
    return proposal_store.issue(user.id, session_id, session.team_id, 'memo.create', [
        dict(text=c.text, section=c.section, detail=c.detail) for c in candidates])


def process_memo_proposal(db, shared_db, user, proposal_id, selected_ids=None, cancel=False):
    entry = proposal_store.read(proposal_id, user.id)
    if entry['kind'] != 'memo.create':
        raise ProposalError('Wrong proposal kind')
    session = authorize_session(db, shared_db, user, entry['session_id'])
    if session.team_id != entry['team_id']:
        raise HTTPException(409, '프로젝트 소속이 변경되었습니다. 다시 검토하세요.')
    if cancel:
        return proposal_store.cancel(proposal_id, user.id)

    def write(items):
        try:
            # SQLite obtains the write lock before checking duplicates. All selected
            # items commit together; no success receipt is produced before commit.
            db.rollback()
            if db.bind.dialect.name == 'sqlite':
                from sqlalchemy import text
                db.execute(text('BEGIN IMMEDIATE'))
            current = authorize_session(db, shared_db, user, entry['session_id'])
            if current.team_id != entry['team_id']:
                raise HTTPException(409, '프로젝트 소속이 변경되었습니다. 다시 검토하세요.')
            notes = prepare_memo_candidates(items, entry['session_id'])
            rows = []
            for note in notes:
                duplicate = db.query(MemoItem).filter_by(session_id=note.session_id, text=note.text,
                                                         section=note.section, detail=note.detail).first()
                if duplicate:
                    raise HTTPException(409, '동일한 메모가 존재합니다. 다시 검토하세요.')
                row = MemoItem(session_id=note.session_id, team_id=entry['team_id'], text=note.text,
                               section=note.section, detail=note.detail, selected_text='')
                db.add(row)
                rows.append(row)
            db.flush()
            result = {'state': 'succeeded', 'session_id': entry['session_id'], 'created': len(rows),
                      'memos': [dict(id=r.id, text=r.text, section=r.section, detail=r.detail) for r in rows]}
            db.commit()
            return result
        except Exception:
            db.rollback()
            raise

    return proposal_store.execute(proposal_id, user.id, selected_ids, write)
