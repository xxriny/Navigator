"""Review exact team assignment snapshots before one authorized transaction."""
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import text
from pipeline.domain.agile.approval_store import proposal_store, ProposalError
from pipeline.domain.agile.manual_tasks import authorize_team, TYPES
from pipeline.domain.agile.task_coordinator import AgileTask, _task_to_dict, _now
from pipeline.domain.agile.nodes.task_distributor import run_task_distributor, _get_team_members, _is_compatible


def _current_member(shared_db, team_id, candidate):
    members = _get_team_members(team_id, shared_db)
    matches = [m for m in members if m['name'] == candidate['assignee_name']]
    if (len(matches) != 1 or matches[0]['id'] != candidate['assignee_id']
            or matches[0]['role'] != candidate['assignee_role']):
        raise HTTPException(409, '팀원 정보가 변경되었습니다. 배분안을 다시 검토하세요.')
    return matches[0]


def generate_assignment_proposal(db, shared_db, user, team_id, api_key, model):
    authorize_team(shared_db, user, team_id, pm=True)
    members = _get_team_members(team_id, shared_db)
    snapshots = [_task_to_dict(t) for t in db.query(AgileTask).filter_by(team_id=team_id).all()]
    # Give the model only a copy; the server snapshot remains authoritative.
    from copy import deepcopy
    result = run_task_distributor(team_id, api_key, model, members=deepcopy(members), tasks=deepcopy(snapshots))
    db.rollback(); shared_db.rollback()
    authorize_team(shared_db, user, team_id, pm=True)
    by_id = {t['id']: t for t in snapshots}
    items, seen = [], set()
    for candidate in result['assignment_proposals']:
        snapshot = by_id.get(candidate['task_id'])
        if (snapshot is None or snapshot['status'] != 'unassigned' or snapshot['task_type'] not in TYPES
                or candidate['task_id'] in seen):
            raise ProposalError('유효하지 않은 배분 대상입니다.')
        member = _current_member(shared_db, team_id, candidate)
        if not _is_compatible(member['role'], snapshot['area']):
            raise ProposalError('태스크 영역과 담당자 역할이 맞지 않습니다.')
        current = db.get(AgileTask, snapshot['id'], populate_existing=True)
        if current is None or _task_to_dict(current) != snapshot:
            raise HTTPException(409, '태스크가 변경되었습니다. 배분안을 다시 생성하세요.')
        seen.add(snapshot['id'])
        items.append(dict(operation='assign', task=snapshot, member=member, reason=candidate['reason']))
    entry = proposal_store.issue(user.id, team_id, team_id, 'task.assignment', items) if items else None
    return {**result, 'review_proposal': entry}


def process_assignment_proposal(db, shared_db, user, proposal_id, selected_ids=None, cancel=False):
    if user is None:
        raise HTTPException(401, '로그인이 필요합니다.')
    entry = proposal_store.read(proposal_id, user.id)
    if entry['kind'] != 'task.assignment':
        raise ProposalError('잘못된 제안 유형입니다.')
    authorize_team(shared_db, user, entry['team_id'], pm=True)
    if cancel:
        return proposal_store.cancel(proposal_id, user.id)

    def write(items):
        try:
            db.rollback(); shared_db.rollback()
            if db.bind.dialect.name == 'sqlite':
                db.execute(text('BEGIN IMMEDIATE'))
            authorize_team(shared_db, user, entry['team_id'], pm=True)
            assigned = []
            for item in items:
                snapshot, member = item['task'], item['member']
                _current_member(shared_db, entry['team_id'], dict(assignee_id=member['id'], assignee_name=member['name'], assignee_role=member['role']))
                row = db.get(AgileTask, snapshot['id'], populate_existing=True)
                if (row is None or row.team_id != entry['team_id'] or row.status != 'unassigned'
                        or row.task_type not in TYPES or _task_to_dict(row) != snapshot
                        or not _is_compatible(member['role'], row.area or '')):
                    raise HTTPException(409, '태스크가 변경되었습니다. 최신 배분안을 다시 검토하세요.')
                count = db.query(AgileTask).filter(
                    AgileTask.id == row.id, AgileTask.team_id == entry['team_id'],
                    AgileTask.status == 'unassigned', AgileTask.updated_at == datetime.fromisoformat(snapshot['updated_at']),
                ).update(dict(status='pending_approval', assignee=member['name'], reviewed_by=user.id, updated_at=_now()), synchronize_session=False)
                if count != 1:
                    raise HTTPException(409, '태스크가 변경되었습니다. 다시 검토하세요.')
                assigned.append(row.id)
            db.commit()
            return {'state':'succeeded', 'assigned':len(assigned), 'assigned_ids':assigned}
        except Exception:
            db.rollback()
            raise
    return proposal_store.execute(proposal_id, user.id, selected_ids, write)
