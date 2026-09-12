# 인증·대화 격리·GitHub·메뉴 문제 실행 계획

작성: 2026-09-11. 담당: AGILE-SEC 전성빈. 상태: 분석 및 실패 회귀 테스트 완료, 공용 구현 승인 대기.
저장소: C:\Users\jsb46\Generative_AI\NAVIGATOR_ver1
브랜치: security/agile-chat-write-gate
HEAD: b9332f82af31f81d963ab7c5653bfd1a48496ade
main 및 merge-base: ae43fe9ae119629cbfc9cbaa1f55c15babede926
이 문서는 변경 승인 자체가 아니다. 기존 P0~P5 완료 기록과 이번 목표의 완료 상태를 합산하지 않는다.

## 1. 기준선과 승인

AGENTS.md, docs/specs/llm-injection-collaboration.md, skill.md, spec.md, 기존 구현 계획과 변경 기록을 확인했다. 기대 브랜치이며 로컬 main이 현재 브랜치의 조상이다. 원격 최신 상태는 fetch하지 않아 확인하지 않았다.
기존 추적 파일 16개의 수정과 미추적 구현·테스트·문서·실행 로그가 존재한다. 그대로 보존한다.
AGENTS.md가 참조한 C:\Users\ning\.codex\RTK.md는 이 PC에 없다. 별도 navigator-llm-injection 스킬도 저장소 검색에서 발견하지 못했다. 사용 가능한 로컬 skill.md의 분석·테스트·기록 절차를 적용한다.
기존 승인된 태스크·메모 연결 및 서버 URL 교체를 이번 전체 인증 리팩터링 승인으로 확대하지 않는다.

이번에 추가한 파일:
- backend/pipeline/domain/chat/test/test_session_access_boundary.py: 임시 SQLite와 실제 REST 라우터를 사용하는 계정 격리 수용 테스트 4개. 운영 DB 및 원격 서버를 호출하지 않는다.
- AGILE_SEC_AUTH_REPAIR_PLAN.md: 이 계획과 승인 요청 대상.
기존 AGILE_SEC_CHANGELOG.md에 변경027을 추가한다. 공용 제품 코드 변경 없음.

## 2. 확인된 사실과 미확인 항목

| 문제 | 현재 근거 | 판정 |
| --- | --- | --- |
| 로그인 시 세션 만료 | src/api/serverClient.js의 serverRequest는 모든 401에서 clearAuth 후 같은 메시지를 반환한다. server/routers/auth.py 로그인은 자격증명 불일치에 401을 반환한다. | 오류 메시지 손실은 코드로 확인. 사용자의 정상 비밀번호 로그인이 실패하는 정확한 원인은 미재현. |
| 로컬 프로젝트 401 | 프런트는 원격 토큰을 로컬 /api/projects로 전송한다. backend/auth/deps.py는 로컬 JWT 검증 및 로컬 User 조회를 수행한다. 서버 JWT_SECRET과 로컬 NAVIGATOR_JWT_SECRET 설정 출처가 다르다. | 계약 불일치 확인. 배포 중 실제 키값과 사용자 데이터는 열람하지 않음. |
| 라이브러리 노출 | storeHelpers.js는 공통 pm_sessions 키 사용. SessionPanel.jsx는 team_id 없는 기록을 모든 팀에 포함. clearAuth는 sessions와 chatHistory를 비우지 않는다. | 코드로 확인. 계정 A/B 실제 앱 전환은 미실행. |
| 세션 API 노출 | 실제 라우터와 임시 DB에서 익명 및 다른 계정이 개인 결과를 HTTP 200으로 받음. | 격리 HTTP 테스트로 재현. 원격 실계정 테스트 아님. |
| 세션 삭제 | rest_handler.py:418은 타임스탬프 ID만 검사하고 실제 삭제 없이 성공을 반환한다. | 이전의 무단 실제 삭제 가능성 주장을 정정. 무인증 성공 응답과 삭제 미구현이 별도 결함. UUID 분석 ID도 현재 계약과 불일치. |
| 중복 프로젝트 요청 | ensureServerSession에는 동일 키의 진행 중 Promise 공유가 이미 존재한다. 서버 create_project는 매번 새 UUID로 생성한다. | 서버 멱등성 부재 확인. 두 POST의 정확한 발생 원인은 미확정. StrictMode 탓으로 단정하지 않음. |
| GitHub Client ID | LoginScreen.jsx:121은 로컬 /auth/setup-oauth에 저장하지만 server/routers/auth.py:711,731의 Device Flow는 서버 환경변수를 읽는다. | 설정 출처 불일치 확인. 배포된 환경변수 존재 여부는 미확인. |
| + 메뉴 | HomeScreen.jsx:545의 PlusMenu가 top-[40px]로 아래쪽에 고정됨. 동일 메뉴가 초기 입력창과 하단 입력창에서 사용됨. | 하단 잘림 가능성 확인. 사용자가 의미한 버튼 및 배율별 화면 재현 필요. |
| SQLite 유지 | server/database.py 기본값은 앱 디렉터리 shared.db, Dockerfile은 /app, .dockerignore는 *.db 제외. DATABASE_URL/SHARED_DB_PATH 재정의 가능. | 배포된 볼륨·DB 설정은 미조회. 기본 구성에서 인스턴스 종료 시 유실 위험. |

Cloud Run 파일시스템 유지 조건 공식 근거: https://docs.cloud.google.com/run/docs/container-contract#file_system
데이터를 유지하려고 min instances만 늘려도 재시작·배포 유실이 해결되지는 않는다. SQLite 선택을 임의로 바꾸거나 유료 DB를 생성하지 않는다.

## 3. 실행 순서와 완료 증거

각 묶음은 구현과 해당 검증이 모두 충족돼야 완료다. 테스트 개수로 제품 완료율을 계산하지 않는다.

### W0 기준선/재현 — 진행 중
- 완료: 브랜치/문서/승인 경계 확인, 임시 DB 회귀 4개 작성, 기존 Agile·Chat 회귀 실행.
- 남음: 실제 로그인 응답의 status/detail을 비밀값 없이 확인, + 버튼 특정, 중복 요청 호출 경로 추적.
- 서버 관리 조회가 가능할 때 DB URL은 자격증명을 출력하지 않고 저장 방식/볼륨 유무만 확인.

### W1 인증 오류와 사용자 컨텍스트 — 승인 필요
- 로그인/가입의 401에는 서버의 안전한 오류 내용을 전달한다. 인증된 API의 401만 유효한 현재 요청인지 확인 후 로그아웃 처리한다.
- 오래된 계정 A 요청의 401이 새 계정 B를 로그아웃시키지 않도록 요청 시 토큰/사용자/인증 세대와 현재 값을 대조한다.
- 네트워크 장애는 unavailable, 실제 인증 실패는 unauthenticated로 구분. 보호된 쓰기는 검증 완료 전 허용하지 않는다.
- 명시적 Authorization 헤더의 원격 토큰으로 원격 사용자와 팀 역할을 검증한다. 서명키를 데스크톱에 복사하지 않는다.
- 로컬 ORM 의존성이 많으므로 검증된 사용자/멤버십의 요청 단위 어댑터와 최소 로컬 미러 중 영향이 작은 방식을 결정한다. 단순 /auth/me 호출로 완료하지 않는다.
- 미러를 선택하면 발급자+원격 ID를 구분하여 기존 로컬 ID 충돌 방지, 역할 변경/탈퇴 반영, 기존 수동 로컬 멤버십과의 구분, 실패 중 부분 동기화 rollback이 필요하다. 사용자 비밀번호·JWT 서명키·GitHub 비밀 토큰은 동기화하지 않는다.
- 초기 권한 캐시는 요청 수명으로 제한한다. 장기 TTL을 임의로 도입하지 않는다. 원격 장애 시 503/재시도 안내, 인증 실패는 401, 팀 권한 부족은 403으로 구분한다.
- Runner가 user.github_oauth_token을 직접 요구하는 기존 호출도 호환 검토한다. 인증 통합 때문에 클라이언트로 원격 비밀 토큰을 새로 전달하지 않는다.
- 검증: 정상 로그인/재로그인, 틀린 비밀번호, 만료, 오프라인, 늦은 401, 역할 변경/팀 탈퇴, 로컬 ID 충돌.

### W2 REST·WebSocket·프로젝트 멱등성 — W1 이후, 승인 필요
- REST와 Runner/WebSocket의 보호된 메시지에서 동일한 검증 결과를 사용한다. payload의 사용자/역할/팀 선언을 권한 증거로 사용하지 않는다.
- 요청 시작과 저장 직전 권한을 확인하고 계정/팀 변경 후 늦은 응답을 프런트에서 반영하지 않는다.
- 사용자+팀+클라이언트 세션 키와 요청 내용 해시로 멱등성을 정의한다. 같은 키에 다른 내용은 충돌로 반환한다.
- 서버 재시작/동시 연결에서도 중복을 막으려면 DB 유니크 제약/트랜잭션이 필요하다. 프로세스 메모리 Map만으로 완료하지 않는다. 공용 모델/마이그레이션 승인 후 적용한다.
- 검증: 무인증 401, 비소속 팀 403, 동시 2요청/응답 유실 후 재시도에 동일 프로젝트 1개, 다른 사용자·팀 키 분리, WS 미인증·권한상실 저장0건.

### W3 세션 저장·복원·삭제 권한 — W1 이후, 승인 필요
- 개인 대화와 명시적 팀 공유 분석을 구분한다. team_id가 있다는 이유만으로 개인 대화를 공유하지 않는다.
- 현재 authorize_session은 팀 소속이면 접근 가능한 기존 팀 프로젝트 정책이다. 이를 무조건 소유자 전용으로 바꿔 기존 공유 기능을 깨뜨리지 않는다.
- 명시적 개인/팀 공개 범위 데이터 계약을 모델 및 프런트 생성 흐름과 함께 설계한다. 기존 모호한 기록은 보존하되 자동 공개/자동 귀속하지 않는다.
- 복원/목록/수정/삭제 API에 인증, 소유권 또는 명시적 팀 공유 권한 검사. ownerless 데이터는 별도 이전 절차가 정해질 때까지 접근 거부.
- 삭제는 UUID와 기존 ID를 모두 처리하되 사용자 의도와 참조 관계를 확인하고 트랜잭션으로 실제 수행한다. 팀 공유 자료의 삭제 권한을 읽기 권한과 구분한다.
- 프런트 저장소는 사용자+팀별 분리. 로그아웃/전환 시 활성 대화/메모/프로젝트/뷰포트/진행 요청까지 초기화. 기존 pm_sessions는 보존하고 명시적 이전 대상으로 격리.
- localStorage 분리는 같은 OS 프로필의 악의적 로컬 사용자를 막는 암호화가 아니다. JWT/GitHub 토큰/API 키 저장도 후속 보안 점검 대상.
- 검증: 신규 실패 테스트3개를 통과시킨 뒤 실제 삭제·다른 사용자 삭제 차단·공유 접근 유지·역할상실·legacy 보존·지연 응답·A/B 전환 케이스 확장.

### W4 GitHub 설정과 Device Flow — 승인 필요
- 서버 공통 Client ID를 로그인 전 설정 출처로 통일. 프런트의 로컬 Client Secret 입력 경로는 제거/안내 변경.
- 팀별 OAuth 설정은 인증 후 관리 기능과 구분. 로그인 이전에 임의 팀 설정을 선택하지 않는다.
- Device Flow 활성화 및 배포 환경변수 확인 절차 준비. 서버 설정 갱신/배포는 별도 승인 후.
- OAuth 상태가 메모리에 저장되는 실제 경로를 먼저 추적한다. _oauth_sessions 변수 존재만으로 Device Flow가 해당 상태를 사용하는 것으로 단정하지 않는다.
- 검증: start, pending, slow_down, cancel/denied, expiry, 재시작, 기존 계정 연결, 성공 후 계정 전환 시 늦은 결과 무시.

### W5 메뉴 — 버튼 확인 및 프런트 승인 후, W1과 독립
- 초기 입력창/하단 입력창 위치에 따라 위/아래로 열고 경계 제한·max-height·스크롤 적용.
- 검증: 두 입력창, 작은 창, 125/150% 배율, 페이지 스크롤, 키보드 및 바깥 클릭 닫기.

### W6 통합/실사용 검증 — W1~W5 이후
- 기존 Agile50/Chat30 회귀와 새 공격 회귀, 프런트 테스트, 빌드, API 직접 호출, 실제 앱 A/B 시나리오.
- 임시 DB/mock 통과를 실제 Cloud Run 인증 및 실제 GitHub 성공으로 확대하지 않는다.
- SQLite 유지 한계를 별도 표시하고 사용자 승인 없는 운영 계정 생성·데이터 삭제·재배포를 하지 않는다.
- 다섯 문제 각각 실제 시나리오 검증 전까지 목표 완료 처리 금지.

## 4. 공용 변경 승인 요청표

팀 Spec에 개인 담당자가 없는 파일은 담당자를 추측하지 않는다. 아래 공용·프런트 담당자 지정과 영향받는 팀원 합의가 필요하다.

| 파일 | 소유/영향 | 최소 변경 |
| --- | --- | --- |
| src/api/serverClient.js | 공통 프런트 API, 담당 미지정 | 401 의미 구분, 과거 요청이 새 계정을 해제하지 않도록 컨텍스트 검사 |
| src/store/slices/authSlice.js | 공통 인증 상태, 담당 미지정 | 인증 상태 구분, 계정 전환 정리, 권한 세대 |
| backend/auth/deps.py, backend/auth/service.py | 공통 인증, 전 도메인 | 원격 검증 어댑터, 실패 분류; 로컬 토큰 발급과 호환 정책 |
| backend/auth/models.py, backend/auth/shared_models.py, backend/auth/database.py | 공용 DB 모델/마이그레이션 | 필요 시 발급자 구분, 세션 공개 범위, 멱등 키·유니크 제약; 기존 데이터 보존 |
| backend/orchestration/pipeline_runner.py | PM/SA 담당 A와 공용 | REST와 같은 인증·권한 사용, 기존 GitHub 의존 호환 |
| backend/transport/ws_handler.py | 공용 transport | 보호 메시지 인증 컨텍스트, 오류·계정 변경 경계 |
| backend/transport/rest_handler.py | 공용 API/DTO | 세션 복원·삭제 권한 및 실제 삭제, 프로젝트 멱등 키 |
| src/api/services/sessionService.js | 프런트 공용 session client | 복원/삭제 인증 헤더 및 멱등 키 전달 |
| src/store/storeHelpers.js, src/store/slices/sessionSlice.js, src/store/useAppStore.js | 프런트 공통 저장/세션 | 계정별 저장, legacy 격리, 로드/삭제 권한 상태 |
| src/store/slices/pipelineSlice.js | 프런트 공통 비동기 상태 | 계정 변경 후 결과 반영 차단 |
| src/components/SessionPanel.jsx | 라이브러리 UI, 담당 미지정 | 사용자 및 공개 범위에 따른 목록 |
| src/components/auth/LoginScreen.jsx, server/routers/auth.py | 공통 로그인/GitHub, 담당 미지정 | OAuth 설정 출처/오류 계약 통일 |
| src/components/HomeScreen.jsx | 홈/채팅 프런트, 담당 미지정 | 확인된 + 메뉴 위치 보정 |

새 공통 인증 어댑터 파일이 필요하면 위 공통 인증 범위와 함께 승인받는다. server DB 설정/마이그레이션 변경 및 배포는 아직 포함하지 않는다. 인접 DEV/PM/SA 노드나 GitHub Connector 수정이 새로 필요하면 정확한 파일별 추가 검토한다.

## 5. 현재 테스트 결과와 재실행

backend 디렉터리에서:
- .venv/Scripts/python.exe -B -m unittest pipeline.domain.chat.test.test_session_access_boundary -v
  결과: 4개 중1개 통과,3개 실패. 익명 복원200, 타 계정 복원200, 익명 삭제200 때문에 의도한 접근 거부 assertion 실패. owner 복원 정상.
- .venv/Scripts/python.exe -B -m unittest discover -s pipeline/domain/agile/test -p test_*.py
  결과: 기존50개 통과.
- .venv/Scripts/python.exe -B -m unittest discover -s pipeline/domain/chat/test -p test_*.py
  결과:34개 중31개 통과, 새3개만 실패. 기존30개 통과 유지.

실제 FastAPI 라우터와 SQLite 쿼리를 실행했다. 인증 사용자와 DB 연결만 테스트용으로 주입했다. 실제 사용자 로그인, 원격 토큰 검증, 실제 모델/GitHub/Cloud Run은 검증하지 않았다.
제품 코드 변경 전 단계라 프런트 빌드를 반복하지 않았다.
회귀 테스트는 미해결 결함을 숨기지 않도록 skip/expectedFailure로 바꾸지 않았다. Chat 전체 테스트는 현재 실패 상태가 맞다.

## 6. 사용자가 확인할 수동 시나리오 (수정 후 수행)

1. 계정 A로 가입/로그인하고 대화1개 작성 → 로그아웃 → 같은 자격증명 재로그인: 정상 진입, 동일 개인 기록.
2. 잘못된 비밀번호 입력: 비밀번호/이메일 불일치 안내. 네트워크 끊기: 연결 장애 안내. 두 경우를 세션 만료로 통합하지 않음.
3. 계정 B 진입: A의 개인 기록 없음. A의 알려진 run_id 직접 복원/삭제:403 또는404, A 데이터 유지.
4. 명시적으로 공유한 팀 분석은 해당 팀원에게만 표시. 다른 팀 및 탈퇴 사용자 차단.
5. 분석 시작을 연속 실행/응답 유실 후 재시도: 같은 멱등 키의 프로젝트1개. 서로 다른 의도적 대화는 각각 생성.
6. 분석 중 로그아웃/계정 전환: 과거 응답이 새 계정에 표시/저장되지 않음.
7. GitHub 연결: Device Flow 시작 및 허용/취소/만료 표시. 비밀값을 화면 캡처나 테스트 기록에 포함하지 않음.
8. 실제 문제가 있는 + 버튼을 초기/하단 입력창, 작은 창,125/150%배율에서 확인: 메뉴 전체 접근 가능.
9. 계정 저장 유지 검증은 백업과 별도 배포 승인 후 수행. 현재 서버를 임의 재시작하지 않음.

현재 다섯 제품 문제 중 해결 완료로 판정한 항목은 0개다. 분석·실패 재현을 제품 수정 완료율로 환산하지 않는다.
되돌리기: 이번 신규 테스트와 계획만 정확히 제거하고 변경027만 철회하면 이번 작업 전 상태다. 저장소 전체 reset/clean을 사용하지 않는다. 제품/DB 이전은 이번에 수행하지 않았다.

## 7. 후속 재현 및 설계 정정 (2026-09-11)

- backend/pipeline/domain/chat/test/memo_store.test.mjs에 Chat 계정 경계 테스트3개 추가. 기존 helper로 실제 authSlice/sessionSlice를 VM 안에서 실행한다. 서비스와 localStorage는 격리된 테스트 대체물이며 실제 브라우저/원격 로그인 검증이 아니다.
- 명령(저장소 루트): node --experimental-vm-modules --test backend/pipeline/domain/chat/test/memo_store.test.mjs
- 결과15개 중13개 통과,2개 실패. 기존12개 모두 통과. 로그아웃 뒤 private chatHistory가 남고, 같은 팀의 다른 계정 setAuth 뒤에도 남는 두 결함을 재현했다. 공용 제품 코드 미수정.
- 동일 local session/user/team/token/backend/serverSessionId의 동시에 진행되는 두 ensureServerSession 호출은 createProject1회로 합쳐지는 정상 동작을 확인했다. 중복 POST 원인을 단순 Promise dedup 누락으로 결론 내리지 않는다. 5개 호출자는 sessionSlice의 메모 저장/조회 및 pipelineSlice의 분석/변경/아이디어 채팅 경로이며, 실패 후 재시도·다른 renderer·키가 바뀐 요청의 상관관계를 추가 확인해야 한다.
- GitHub Device Flow 재검토: server/routers/auth.py의 _oauth_sessions는 선언만 있고 이 파일에서 사용되지 않는다. Device Flow는 클라이언트가 제출한 device_code를 GitHub로 전달한다. 따라서 이 Device Flow를 위해 메모리 상태를 영속 저장소로 옮겨야 한다는 이전 제안은 근거가 없으며 필수 변경에서 제외한다. 재시작/네트워크 오류 복구 검증은 유지하되 새 저장소를 불필요하게 도입하지 않는다.
- 추가 GitHub 코드 결함 후보: poll에서 Authorization을 제공했어도 토큰 검증 실패하면 로그인되지 않은 흐름으로 내려간다. 연결 요청의 세션 만료를 신규/다른 계정 로그인으로 바꾸지 않도록 명시적 로그인/연결 목적을 구분하고, 인증 헤더가 있는 연결 요청의 실패는401로 중단해야 한다.
- 기존 GitHub ID가 다른 사용자에게 연결돼 있으면 현재 코드는 그 계정의 연결을 자동 해제한다. 계정 연결 충돌은409로 알리고 자동 해제/자동 이전하지 않는 최소 변경이 필요하다. GitHub 사용자 조회 실패/ID 누락 응답도 DB 변경 전에 거부해야 한다. 이 항목은 코드 분석이며 실제 GitHub 연동 공격/계정 변경을 실행하지 않았다. 승인 대상은 기존 표의 server/routers/auth.py와 LoginScreen/authSlice 범위다.
- 새 테스트의 실패를 숨기지 않는다. 현재 Python 신규 접근 경계3개와 JavaScript 신규 계정 상태 경계2개가 미해결이다. 공유 파일 변경 승인에 대한 사용자 답변은 아직 없음.
