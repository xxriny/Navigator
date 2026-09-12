"""Authenticated project registration and analysis ownership propagation.

Project IDs are server generated. Existing ownerless data is never claimed.
Context used here is passed by the request handler, never by model state.
"""
import json
from uuid import uuid4, uuid5, NAMESPACE_URL
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from auth.models import AnalysisSession, AnalysisResult
from auth.shared_models import TeamMember
from pipeline.domain.chat.memo_approval import authorize_session


def create_project(db, shared_db, user, title, team_id=None, client_request_id=None):
    if user is None:
        raise HTTPException(401, '로그인이 필요합니다.')
    from auth.remote_identity import membership
    if team_id and not membership(shared_db, user, team_id):
        raise HTTPException(403, '프로젝트 팀 권한이 없습니다.')
    if client_request_id is not None and (not isinstance(client_request_id, str) or not 1 <= len(client_request_id) <= 128):
        raise HTTPException(422, '프로젝트 요청 키가 올바르지 않습니다.')
    # The existing primary-key constraint arbitrates concurrent requests across
    # processes. The key is scoped to its authenticated actor and team.
    key = json.dumps(['navigator-project-v1', user.id, team_id or None, client_request_id])
    project_id = str(uuid5(NAMESPACE_URL, key)) if client_request_id else str(uuid4())

    def receipt(project):
        if (project.created_by != user.id or project.team_id != (team_id or None) or project.title != title):
            raise HTTPException(409, '동일한 요청 키의 프로젝트 내용이 다릅니다.')
        return dict(session_id=project.run_id, team_id=project.team_id, created_by=project.created_by)

    existing = db.get(AnalysisSession, project_id)
    if existing is not None:
        return receipt(existing)
    project = AnalysisSession(run_id=project_id, team_id=team_id or None, created_by=user.id, title=title)
    try:
        db.add(project)
        db.flush()
        result = receipt(project)
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        winner = db.get(AnalysisSession, project_id)
        if client_request_id and winner is not None:
            return receipt(winner)
        raise
    except Exception:
        db.rollback()
        raise


def authorize_private_result(db, shared_db, user, run_id):
    # Local conversation history is private. Explicit team snapshots keep their
    # separate publication API and existing membership policy.
    session = authorize_session(db, shared_db, user, run_id)
    if not session.created_by or session.created_by != user.id:
        raise HTTPException(403, '개인 분석 기록의 소유권을 확인할 수 없습니다.')
    return session


def restore_private_result(db, shared_db, user, run_id):
    authorize_private_result(db, shared_db, user, run_id)
    record = db.get(AnalysisResult, run_id)
    if record is None:
        raise HTTPException(404, '저장된 분석 결과를 찾을 수 없습니다.')
    return json.loads(record.shaped_result)


def delete_private_result(db, shared_db, user, run_id):
    try:
        db.rollback()
        if db.bind.dialect.name == 'sqlite':
            from sqlalchemy import text
            db.execute(text('BEGIN IMMEDIATE'))
        authorize_private_result(db, shared_db, user, run_id)
        record = db.get(AnalysisResult, run_id)
        if record is not None:
            db.delete(record)
        # Keep the session ownership record: tasks/approvals may reference it.
        # Repeated authorized deletion succeeds without removing unrelated data.
        db.commit()
    except Exception:
        db.rollback()
        raise


def persist_owned_result(db, shared_db, user, project_id, run_id, shaped):
    project = authorize_session(db, shared_db, user, project_id)
    if project.team_id:
        authorize_session(db, shared_db, user, project_id, pm=True)
    if user.role != 'pm':
        raise HTTPException(403, 'PM 권한이 필요합니다.')
    if not run_id or run_id == project_id:
        raise HTTPException(409, '분석 실행 ID가 올바르지 않습니다.')
    existing = db.get(AnalysisSession, run_id)
    if existing is not None:
        # Each request uses a new UUID run ID. Never overwrite someone else's result
        # or attach orphan data based on a caller-supplied ID.
        raise HTTPException(409, '분석 실행 ID가 이미 존재합니다.')
    trusted = {**shaped, 'run_id': run_id, 'project_session_id': project_id}
    try:
        db.add(AnalysisSession(run_id=run_id, team_id=project.team_id, created_by=user.id, title=project.title))
        db.flush()
        db.add(AnalysisResult(run_id=run_id, shaped_result=json.dumps(trusted, ensure_ascii=False)))
        db.commit()
        return trusted
    except Exception:
        db.rollback()
        raise
