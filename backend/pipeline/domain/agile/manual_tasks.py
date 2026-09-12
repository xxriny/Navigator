"""Authenticated explicit manual task operations; no model-driven writes."""
import json
from fastapi import HTTPException
from sqlalchemy import text
from auth.shared_models import TeamMember, User
from pipeline.domain.agile.task_coordinator import AgileTask, _task_to_dict, _now
from pipeline.domain.agile.nodes.task_generator import _normalize

TYPES = {'feature', 'bugfix', 'refactor', 'test', 'infra', 'doc_sync'}
AREAS = {'', 'backend', 'frontend', 'fullstack', 'devops'}
TRANSITIONS = {
    'unassigned': {'unassigned', 'pending_approval', 'rejected'},
    'pending_approval': {'pending_approval', 'in_progress', 'unassigned', 'rejected'},
    'in_progress': {'in_progress', 'pr_pending', 'completed', 'rejected'},
    'pr_pending': {'pr_pending', 'in_progress', 'completed', 'rejected'},
    'completed': {'completed'}, 'rejected': {'rejected', 'unassigned', 'pending_approval'},
}


def authorize_team(shared_db, user, team_id, pm=False):
    if user is None:
        raise HTTPException(401, '로그인이 필요합니다.')
    from auth.remote_identity import membership
    member = membership(shared_db, user, team_id) if team_id else None
    if member is None or (pm and member.role != 'pm'):
        raise HTTPException(403, '팀 권한이 없습니다.')
    return member


def _validate(values):
    for key, limit in [('title', 255), ('description', 16000), ('result', 16000), ('assignee', 255)]:
        if key in values and (not isinstance(values[key], str) or len(values[key]) > limit or '\x00' in values[key]):
            raise HTTPException(422, '태스크 필드 형식 또는 길이가 올바르지 않습니다.')
    if 'title' in values and not values['title'].strip():
        raise HTTPException(422, '제목이 필요합니다.')
    if 'task_type' in values and values['task_type'] not in TYPES:
        raise HTTPException(422, '수동 생성 가능한 태스크 유형이 아닙니다.')
    if 'area' in values and values['area'] not in AREAS:
        raise HTTPException(422, '태스크 영역이 올바르지 않습니다.')
    if 'effort' in values and values['effort'] not in {'', 'S', 'M', 'L', 'XL'}:
        raise HTTPException(422, '공수가 올바르지 않습니다.')


def _member_for_name(shared_db, team_id, name):
    remote_user = shared_db.info.get('remote_actor')
    if remote_user is not None:
        from auth.remote_identity import team_members
        from types import SimpleNamespace
        matches = [row for row in team_members(remote_user, team_id) if row['name'] == name and row['role'] != 'pm']
        if len(matches) != 1:
            raise HTTPException(422, '담당자를 팀에서 고유하게 확인할 수 없습니다.')
        return SimpleNamespace(**matches[0])
    matches = shared_db.query(User).join(TeamMember, TeamMember.user_id == User.id).filter(
        TeamMember.team_id == team_id, User.name == name, TeamMember.role != 'pm').all()
    if len(matches) != 1:
        raise HTTPException(422, '담당자를 팀에서 고유하게 확인할 수 없습니다.')
    return matches[0]


def create_manual_task(db, shared_db, user, values):
    authorize_team(shared_db, user, values['team_id'], pm=True)
    if values.get('payload'):
        raise HTTPException(422, '수동 태스크에 실행·승인 payload를 지정할 수 없습니다.')
    fields = {k: values[k] for k in ('task_type', 'title', 'description', 'area', 'assignee')}
    _validate(fields)
    if fields['assignee']:
        _member_for_name(shared_db, values['team_id'], fields['assignee'])
    try:
        db.rollback()
        if db.bind.dialect.name == 'sqlite': db.execute(text('BEGIN IMMEDIATE'))
        rows = db.query(AgileTask).filter_by(team_id=values['team_id']).all()
        if any(_normalize(r.title) == _normalize(fields['title']) for r in rows):
            raise HTTPException(409, '동일하거나 거절된 태스크가 존재합니다.')
        row = AgileTask(**fields, team_id=values['team_id'], created_by=user.id, reviewed_by=user.id, status='unassigned')
        db.add(row); db.flush()
        result = _task_to_dict(row)
        db.commit()
        return result
    except Exception:
        db.rollback(); raise


def mutate_manual_task(db, shared_db, user, task_id, values=None, delete=False):
    try:
        db.rollback()
        if db.bind.dialect.name == 'sqlite': db.execute(text('BEGIN IMMEDIATE'))
        row = db.get(AgileTask, task_id, populate_existing=True)
        if row is None: raise HTTPException(404, '태스크를 찾을 수 없습니다.')
        member = authorize_team(shared_db, user, row.team_id)
        if row.task_type not in TYPES:
            raise HTTPException(409, '이 태스크는 해당 도메인의 전용 승인 경로를 사용하세요.')
        payload = json.loads(row.payload or '{}')
        protected = bool(payload.get('security'))
        if delete:
            if member.role != 'pm': raise HTTPException(403, 'PM 권한이 필요합니다.')
            if row.status != 'completed' or protected:
                raise HTTPException(409, '완료된 일반 태스크만 삭제할 수 있습니다. 거절·필수 보안 기록은 보존합니다.')
            expected = (values or {}).get('expected_updated_at')
            if not expected or not row.updated_at or expected != row.updated_at.isoformat():
                raise HTTPException(409, '태스크가 변경되었거나 기준 버전이 없습니다. 다시 검토하세요.')
            db.delete(row); db.commit()
            return {'deleted': True}
        values = dict(values)
        expected = values.pop('expected_updated_at', None)
        if not expected or not row.updated_at or expected != row.updated_at.isoformat():
            raise HTTPException(409, '태스크가 변경되었거나 기준 버전이 없습니다. 새로고침 후 다시 검토하세요.')
        target_status = values.pop('status')
        values.pop('reviewed_by', None)
        changes = {k: v for k, v in values.items() if v is not None and getattr(row, k) != v}
        if target_status not in TRANSITIONS.get(row.status, set()):
            raise HTTPException(409, '허용되지 않은 상태 전환입니다.')
        if member.role != 'pm':
            owner = _member_for_name(shared_db, row.team_id, row.assignee) if row.assignee else None
            own_transitions = {
                'pending_approval': {'in_progress', 'rejected'},
                'in_progress': {'in_progress', 'pr_pending', 'completed'},
                'pr_pending': {'in_progress', 'pr_pending', 'completed'},
            }
            allowed_fields = {'result'} if row.status == 'pending_approval' and target_status == 'rejected' else set()
            if (owner is None or owner.id != user.id or set(changes) - allowed_fields
                    or target_status not in own_transitions.get(row.status, set())):
                raise HTTPException(403, '이 변경에는 팀 PM 권한이 필요합니다.')
        _validate(changes)
        if protected and set(changes) - {'result', 'assignee'}:
            raise HTTPException(409, '필수 보안 기준은 일반 수정으로 변경할 수 없습니다.')
        if changes.get('assignee'): _member_for_name(shared_db, row.team_id, changes['assignee'])
        if 'title' in changes:
            others = db.query(AgileTask).filter(AgileTask.team_id == row.team_id, AgileTask.id != row.id).all()
            if any(_normalize(r.title) == _normalize(changes['title']) for r in others):
                raise HTTPException(409, '동일하거나 거절된 제목이 존재합니다.')
        if target_status == 'pending_approval' and not changes.get('assignee', row.assignee):
            raise HTTPException(422, '배분할 담당자가 필요합니다.')
        for key, value in changes.items(): setattr(row, key, value)
        row.status, row.reviewed_by, row.updated_at = target_status, user.id, _now()
        db.flush(); result = _task_to_dict(row); db.commit()
        return result
    except Exception:
        db.rollback(); raise
