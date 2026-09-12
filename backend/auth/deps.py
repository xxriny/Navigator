"""
FastAPI Depends: 현재 사용자 추출, 역할 기반 권한 체크
"""

from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional

from auth.database import get_shared_db
from auth.shared_models import User
from auth.service import decode_token, get_user_by_id


def _extract_token(authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def get_current_user_optional(
    token: Optional[str] = Depends(_extract_token),
    db: Session = Depends(get_shared_db),
) -> Optional[User]:
    if not token:
        return None
    from auth.remote_identity import auth_mode, resolve_user
    if auth_mode() == 'remote':
        try:
            user = resolve_user(token)
        except HTTPException as exc:
            if exc.status_code == 401:
                return None
            raise
        db.info['remote_actor'] = user
        return user
    payload = decode_token(token)
    if not payload:
        return None
    user = get_user_by_id(db, payload.get("sub", ""))
    return user


def get_current_user(
    user: Optional[User] = Depends(get_current_user_optional),
) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    return user


def require_pm(user: User = Depends(get_current_user)) -> User:
    if user.role != "pm":
        raise HTTPException(status_code=403, detail="PM 권한이 필요합니다.")
    return user


def require_engineer(user: User = Depends(get_current_user)) -> User:
    #author: xxrin
    # shared DB role 제약과 동일한 허용 목록만 사용해 인증/인가 기준을 일관되게 유지한다.
    if user.role not in ("pm", "software_engineer", "backend", "frontend", "devops"):
        raise HTTPException(status_code=403, detail="엔지니어 이상 권한이 필요합니다.")
    return user
