"""Cloud identity authority for the desktop backend; no signing keys or DB mirror.

Bearer tokens are retained only for the request lifetime. Membership checks are
fresh remote reads, including checks immediately before local writes.
"""
from dataclasses import dataclass, field
from types import SimpleNamespace
from urllib.parse import urlsplit, quote
import os
import httpx
from fastapi import HTTPException

DEFAULT_SERVER = "https://navigator-server-681502864272.asia-northeast3.run.app"
ROLES = frozenset({'pm', 'software_engineer', 'backend', 'frontend', 'devops'})

def auth_mode():
    mode = os.environ.get('NAVIGATOR_AUTH_MODE', 'remote')
    if mode not in {'remote', 'local'}:
        raise HTTPException(503, '인증 모드 설정을 확인해주세요.')
    return mode

def open_client():
    return httpx.Client(timeout=10.0, follow_redirects=False)

def remote_get(token, path):
    base = os.environ.get('NAVIGATOR_SERVER_URL', DEFAULT_SERVER).rstrip('/')
    parsed = urlsplit(base)
    if (parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path or
            not parsed.hostname or (parsed.scheme != 'https' and not
            (parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost', '::1'}))):
        raise HTTPException(503, '인증 서버 주소 설정을 확인해주세요.')
    try:
        with open_client() as client:
            response = client.get(base + path, headers={'Authorization': 'Bearer ' + token})
        if response.status_code == 401:
            raise HTTPException(401, '로그인 인증이 만료되었거나 유효하지 않습니다.')
        if response.status_code == 403:
            raise HTTPException(403, '현재 계정에 권한이 없습니다.')
        if response.status_code == 404:
            raise HTTPException(404, '요청한 원격 정보를 찾을 수 없습니다.')
        if response.status_code != 200:
            raise HTTPException(503, '인증 서버를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.')
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError('Invalid identity response')
        return data
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, '인증 서버에 연결할 수 없습니다. 연결을 확인해주세요.') from None

def identity_data(token):
    data = remote_get(token, '/auth/me')
    if (not isinstance(data.get('id'), str) or not data['id'] or len(data['id']) > 36 or
            data.get('role') not in ROLES or not isinstance(data.get('email'), str)):
        raise HTTPException(503, '인증 서버 응답을 검증하지 못했습니다.')
    team = data.get('team_id')
    if team is not None and (not isinstance(team, str) or not team or len(team) > 36):
        raise HTTPException(503, '인증 서버 팀 정보를 검증하지 못했습니다.')
    return data

@dataclass(frozen=True)
class RemoteUser:
    id: str
    email: str
    name: str
    role: str
    team_id: str | None
    github_id: str | None = None
    github_login: str | None = None
    github_username: str | None = None
    _token: str = field(default='', repr=False, compare=False)

    @property
    def github_oauth_token(self):
        # Existing server contract for local Git operations. Never mirror this
        # credential into SQLite or logs; retrieve only when the caller needs it.
        if not self.github_id:
            return None
        data = remote_get(self._token, '/auth/github/token')
        value = data.get('github_oauth_token')
        if not isinstance(value, str) or not value:
            raise HTTPException(503, 'GitHub 연결 정보를 확인할 수 없습니다.')
        return value

def resolve_user(token):
    data = identity_data(token)
    return RemoteUser(**{key: data.get(key) for key in
        ('id', 'email', 'name', 'role', 'team_id', 'github_id', 'github_login', 'github_username')}, _token=token)

def refresh_user(user):
    if isinstance(user, RemoteUser):
        current = resolve_user(user._token)
        if current.id != user.id:
            raise HTTPException(401, '인증 사용자가 변경되었습니다.')
        return current
    return user

def membership(db, user, team_id):
    if isinstance(user, RemoteUser):
        rows = remote_get(user._token, '/auth/users/me/teams').get('teams')
        if not isinstance(rows, list) or any(not isinstance(row, dict) or
                not isinstance(row.get('id'), str) or row.get('role') not in ROLES for row in rows):
            raise HTTPException(503, '팀 권한 응답을 검증하지 못했습니다.')
        matches = [row for row in rows if row['id'] == team_id]
        if len(matches) > 1:
            raise HTTPException(503, '팀 권한이 일치하지 않습니다.')
        return SimpleNamespace(user_id=user.id, team_id=team_id, role=matches[0]['role']) if matches else None
    from auth.shared_models import TeamMember
    return db.query(TeamMember).filter_by(user_id=user.id, team_id=team_id).first()

def team_members(user, team_id):
    rows = remote_get(user._token, '/auth/teams/' + quote(team_id, safe='') + '/members').get('members')
    if not isinstance(rows, list) or any(not isinstance(row, dict) or not row.get('id') or
            not isinstance(row.get('name'), str) or row.get('role') not in ROLES for row in rows):
        raise HTTPException(503, '팀원 응답을 검증하지 못했습니다.')
    if len({row['id'] for row in rows}) != len(rows):
        raise HTTPException(503, '팀원 정보가 중복됩니다.')
    return [{'id': row['id'], 'name': row['name'], 'role': row['role']} for row in rows]
