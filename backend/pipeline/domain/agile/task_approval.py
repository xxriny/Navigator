"""Apply reviewed Agile proposals as one transaction, with PM and version checks."""
import hashlib
import json
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import text
from auth.models import AnalysisResult
from pipeline.domain.agile.approval_store import proposal_store, ProposalError
from pipeline.domain.agile.task_coordinator import AgileTask, _now
from pipeline.domain.agile.nodes.task_generator import _normalize, _validate_proposal_fields
from pipeline.domain.chat.memo_approval import authorize_session
from pipeline.domain.agile.security_rules import validate_scope, missing_tasks


def analysis_digest(shaped_result):
    return hashlib.sha256(shaped_result.encode('utf-8')).hexdigest()


def issue_task_proposal(db, shared_db, user, run_id, team_id, result, expected_digest, known_refs, security_scope, scope_reviewed):
    authorize_session(db, shared_db, user, run_id, team_id=team_id, pm=True)
    record = db.get(AnalysisResult, run_id, populate_existing=True)
    if not record or analysis_digest(record.shaped_result) != expected_digest:
        raise HTTPException(409, '분석 결과가 변경되었습니다. 다시 생성하세요.')
    scope = validate_scope(security_scope, known_refs, scope_reviewed)
    context = dict(analysis_digest=expected_digest, known_refs=sorted(known_refs), security_scope=scope)
    required = missing_tasks(db.query(AgileTask).filter_by(team_id=team_id).all(), scope, run_id)
    items = [dict(operation='create', task=t, context=context) for t in result['task_proposals']]
    items += [dict(operation='update', update=t, context=context) for t in result['update_proposals']]
    items += [dict(operation='create', task=t['task'], security=t['security'], context=context) for t in required]
    if not items:
        return None
    return proposal_store.issue(user.id, run_id, team_id, 'task.review', items)


def process_task_proposal(db, shared_db, user, proposal_id, selected_ids=None, cancel=False):
    entry = proposal_store.read(proposal_id, user.id)
    if entry['kind'] != 'task.review':
        raise ProposalError('Wrong proposal kind')
    authorize_session(db, shared_db, user, entry['session_id'], team_id=entry['team_id'], pm=True)
    if cancel:
        return proposal_store.cancel(proposal_id, user.id)

    def write(items):
        try:
            db.rollback()
            if db.bind.dialect.name == 'sqlite':
                db.execute(text('BEGIN IMMEDIATE'))
            authorize_session(db, shared_db, user, entry['session_id'], team_id=entry['team_id'], pm=True)
            record = db.get(AnalysisResult, entry['session_id'], populate_existing=True)
            if not record or any(analysis_digest(record.shaped_result) != i['context']['analysis_digest'] for i in items):
                raise HTTPException(409, '분석 결과가 변경되었습니다. 다시 검토하세요.')
            created, updated = [], []
            for item in items:
                refs = set(item['context']['known_refs'])
                if item['operation'] == 'create':
                    task = item['task']
                    _validate_proposal_fields(task, refs)
                    rows = db.query(AgileTask).filter_by(team_id=entry['team_id']).all()
                    if any(_normalize(r.title) == _normalize(task['title']) or
                           (task['feature_ref'] and r.feature_ref == task['feature_ref']) for r in rows):
                        raise HTTPException(409, '동일한 태스크가 존재합니다. 다시 검토하세요.')
                    row = AgileTask(**{k: v for k, v in task.items() if k != 'priority'},
                                    status='unassigned', team_id=entry['team_id'],
                                    created_by=user.id, reviewed_by=user.id,
                                    analysis_id=entry['session_id'],
                                    payload=json.dumps({'priority': task['priority'], 'approval_id': proposal_id,
                                                        'security': item.get('security')}))
                    db.add(row)
                    db.flush()
                    created.append(row.id)
                elif item['operation'] == 'update':
                    proposal = item['update']
                    changes = proposal['changes']
                    if not changes or not set(changes).issubset({'title', 'description', 'area', 'effort', 'task_type'}):
                        raise ProposalError('Invalid update fields')
                    _validate_proposal_fields(changes, refs)
                    row = db.query(AgileTask).filter_by(id=proposal['task_id'], team_id=entry['team_id']).first()
                    version = proposal.get('expected_updated_at')
                    if (not row or row.status != 'unassigned' or not version or
                            row.updated_at.isoformat() != version or
                            any(getattr(row, field) != value for field, value in proposal['before'].items())):
                        raise HTTPException(409, '태스크가 변경되었습니다. 다시 검토하세요.')
                    if 'title' in changes:
                        others = db.query(AgileTask).filter(AgileTask.team_id == entry['team_id'], AgileTask.id != row.id).all()
                        if any(_normalize(r.title) == _normalize(changes['title']) for r in others):
                            raise HTTPException(409, '동일한 태스크 제목이 존재합니다.')
                    count = db.query(AgileTask).filter(
                        AgileTask.id == row.id, AgileTask.team_id == entry['team_id'],
                        AgileTask.status == 'unassigned', AgileTask.updated_at == datetime.fromisoformat(version),
                    ).update({**changes, 'updated_at': _now(), 'reviewed_by': user.id}, synchronize_session=False)
                    if count != 1:
                        raise HTTPException(409, '태스크가 변경되었습니다. 다시 검토하세요.')
                    updated.append(row.id)
                else:
                    raise ProposalError('Invalid operation')
            db.flush()
            db.expire_all()
            rows = db.query(AgileTask).filter_by(team_id=entry['team_id']).all()
            if missing_tasks(rows, items[0]['context']['security_scope'], entry['session_id']):
                raise ProposalError('필수 보안 태스크가 누락되었습니다. 보완 후보를 포함해 다시 검토하세요.')
            db.commit()
            return dict(state='succeeded', created=len(created), updated=len(updated),
                        created_ids=created, updated_ids=updated)
        except Exception:
            db.rollback()
            raise

    return proposal_store.execute(proposal_id, user.id, selected_ids, write)
