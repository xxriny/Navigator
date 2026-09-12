"""Deterministic task-presence rules from a PM-reviewed applicability scope.

This verifies required task coverage, not that the feature is implemented securely.
Never infer applicability or fulfilled rules from model prose or title keywords.
"""
import json
from pipeline.domain.agile.approval_store import ProposalError

CAPABILITIES = frozenset({'login', 'password', 'jwt', 'rbac', 'upload', 'archive', 'webhook'})
PROJECT_SCOPE = '__project__'
RULES = {
    'login': [('login_rate_limit', '로그인 요청 횟수 제한', '사용자·IP별 로그인 시도 제한과 초과 응답을 구현하고 우회 및 정상 요청 테스트를 추가한다.'),
              ('authentication_tests', '인증 테스트', '인증 성공·실패·만료·권한 없는 요청을 검증하는 회귀 테스트를 추가한다.')],
    'password': [('password_hashing', '비밀번호 해싱', '비밀번호를 평문 저장하지 않고 적절한 비밀번호 해싱과 검증을 적용하며 저장값 및 검증 실패 테스트를 추가한다.')],
    'jwt': [('jwt_validation', 'JWT 검증', '서명·허용 알고리즘·만료·발급자·대상을 검증하고 위조·만료 토큰을 거부하는 테스트를 추가한다.')],
    'rbac': [('rbac', '역할별 접근 권한 검사', '서버에서 역할·리소스별 접근을 검사하고 비인가 역할의 직접 API 접근을 거부하는 테스트를 추가한다.')],
    'upload': [('upload_size', '업로드 크기 제한', '요청 및 파일 크기 상한을 서버에서 적용하고 제한 초과·경계값 테스트를 추가한다.'),
               ('upload_mime', '업로드 MIME 검증', '클라이언트가 제공한 확장자·Content-Type을 신뢰하지 않고 파일 형식과 허용 MIME을 검증하는 테스트를 추가한다.')],
    'archive': [('archive_bomb', '압축 폭탄 방어', '압축 해제 크기·파일 수·깊이·자원 사용량을 제한하고 초과 아카이브를 차단하는 테스트를 추가한다.')],
    'webhook': [('webhook_signature', 'Webhook 서명 검증', '수신 원문에 대한 서명을 서버에서 검증하고 누락·잘못된 서명을 거부하는 테스트를 추가한다.'),
                ('webhook_replay', 'Webhook 재전송 방지', '타임스탬프·이벤트 식별자를 검증하고 만료되거나 중복된 이벤트의 반복 처리를 차단하는 테스트를 추가한다.'),
                ('webhook_secret', 'Webhook secret 미설정 시 차단', '검증 secret이 설정되지 않았으면 Webhook 처리를 허용하지 않고 오류를 반환하는 테스트를 추가한다.')],
}


def validate_scope(scope, known_refs, reviewed):
    if reviewed is not True or not isinstance(scope, dict) or set(scope) != set(known_refs) | {PROJECT_SCOPE}:
        raise ProposalError('모든 기능과 프로젝트 공통 항목의 보안 적용 여부를 확인하세요.')
    for values in scope.values():
        if (not isinstance(values, list) or any(not isinstance(v, str) or v not in CAPABILITIES for v in values)
                or len(values) != len(set(values))):
            raise ProposalError('알 수 없거나 중복된 보안 적용 항목입니다.')
    return {key: sorted(values) for key, values in sorted(scope.items())}


def required_tasks(scope):
    required = []
    for feature, capabilities in sorted(scope.items()):
        active = set(capabilities)
        if 'password' in active:
            active.add('login')
        for capability in sorted(active):
            for rule_id, title, criteria in RULES[capability]:
                required.append({
                    'security': {'feature_ref': feature, 'rule_id': rule_id},
                    'task': dict(task_type='test', title=f'[보안:{feature}] {title}',
                                 description=criteria, area='backend', priority='high', effort='M', feature_ref=''),
                })
    return required


def identity_matches(row, required, run_id):
    try:
        payload = json.loads(row.payload or '{}')
    except (ValueError, TypeError):
        return False
    return (isinstance(payload, dict) and row.analysis_id == run_id and
            payload.get('security') == required['security'] and bool(payload.get('approval_id')))


def satisfies(row, required, run_id):
    return (identity_matches(row, required, run_id) and row.status != 'rejected' and
            all(getattr(row, field) == value for field, value in required['task'].items() if field != 'priority'))


def missing_tasks(rows, scope, run_id):
    missing = []
    for required in required_tasks(scope):
        matching = [row for row in rows if identity_matches(row, required, run_id)]
        if any(row.status == 'rejected' for row in matching):
            raise ProposalError('거절된 필수 보안 태스크가 있습니다. 적용 범위와 거절 결정을 먼저 검토하세요.')
        if not any(satisfies(row, required, run_id) for row in matching):
            missing.append(required)
    return missing
