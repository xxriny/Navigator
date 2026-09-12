# 공용 파일 변경 기록 — 인증·대화 격리 개선

## 승인 및 기준선

- 사용자 승인: “공용파일 변경을 허락하되, 변경 기록을 따로 남겨줘.”
- 승인 범위: AGILE_SEC_AUTH_REPAIR_PLAN.md와 직전 파일 목록의 인증·세션·GitHub·메뉴 연결 개선.
- 승인에 Cloud Run 배포, 유료 리소스 생성, Git push/merge/PR은 포함되지 않는다.
- 기준 브랜치: security/agile-chat-write-gate.
- 기준 HEAD: b9332f82af31f81d963ab7c5653bfd1a48496ade.
- 이미 존재하던 수정과 이번 수정은 별도 원본 사본으로 구분한다.
- 변경 전 파일 사본과 SHA256: C:/Users/jsb46/OneDrive/Documents/ChatGPT/NAVIGATOR/repair_baseline_20260911/manifest.json.
- 원본 사본에는 선택한 소스/테스트/기록만 포함하며 .env, DB, 토큰, 사용자 대화는 포함하지 않는다.
- 상태: 구현 중. 아래 테스트 결과는 완료된 실행만 기록한다.

## S01 — 인증 오류 회귀 준비

- backend/pipeline/domain/chat/test/server_auth_errors.test.mjs 신규: 로그인401 내용 보존, 과거 요청401이 새 계정을 로그아웃시키지 않음, 현재 토큰401 로그아웃.
- 실제 serverClient 모듈을 VM에서 실행하고 HTTP401 및 상태 저장소만 대체한다. 실제 Cloud Run 로그인 테스트가 아니다.


## S02 — 제품 프런트 인증·계정 격리 (2026-09-11)

| 파일 | 변경 전 → 변경 후 | 이유/호환성 |
| --- | --- | --- |
| src/api/serverClient.js | 모든401 로그아웃 → 로그인 오류 내용 보존, 현재 bearer 요청만 로그아웃 | 과거 계정의 늦은401이 새 계정을 해제하지 않음. error.status 추가 |
| src/store/slices/authSlice.js | 메모만 비움 → 계정/팀 변경 시 개인 대화·결과·파일·워크스페이스 초기화, 사용자별 복원 | authStatus/authGeneration 추가, 팀 전환은 원격 확인 후 적용 |
| src/store/storeHelpers.js | 단일 pm_sessions → 사용자ID/팀ID별 v2 키와 owner 필터 | legacy 키는 그대로 보존하고 자동 귀속하지 않음 |
| src/store/slices/sessionSlice.js | 소유자 없는 세션 → owner_user_id/private 기록, 저장/로드/이름 변경 권한 확인 | 새 로컬ID UUID, 복원 요청 후 계정/프로젝트 재확인 |
| src/components/SessionPanel.jsx | 같은 팀/팀없는 모든 대화 표시 → 현재 소유자의 해당 팀 개인 목록 | 팀 공유 산출물은 별도 스냅샷 경로 유지 |
| src/api/services/sessionService.js | 복원/삭제 무인증 → 인증 헤더와 URI 인코딩 | 인증 없는 구버전 호출은 서버에서 거절 |
| src/store/useAppStore.js | 삭제 실패 무시/로컬 목록만 제거 → 서버 성공 후 현재 계정 목록과 저장소 반영 | 실패한 삭제를 성공으로 표시하지 않음 |
| src/store/slices/pipelineSlice.js | 사고 버퍼 잔존 → resetPipelineRuntime으로 타이머와 버퍼 제거 | 계정 전환 이전 지연 메시지 제거 |
| src/store/slices/wsSlice.js | 이전 소켓 응답 수신 → 인증 세대 및 소켓 동일성 검사, 전환 시 재연결 | sendWsMessage(type,payload) 공개 계약 유지, 연결중 중복 생성 방지 |

- 수정 전: server_auth_errors 3개 중2개 실패(자격증명 오류 소실/과거401 로그아웃). memo_store의 계정 격리2개도 실패 확인.
- 수정 후: node --experimental-vm-modules --test backend/pipeline/domain/chat/test/*.test.mjs backend/pipeline/domain/agile/test/*.test.mjs →32개 모두 통과.
- 실제 제품 모듈 실행, 원격 응답 및 메모 API는 테스트 대체물. 실제 Cloud Run/GitHub 로그인 성공 근거가 아님.
- memo_store의 legacy parked workspace 허용 기대값을 차단 기대값으로 변경. 예전 계정 기록을 자동 복원하지 않는 요구사항에 맞춤.
- DB/Cloud 환경 변경 없음. 기존 localStorage pm_sessions를 읽어 이전하거나 삭제하지 않음.
- 추가 확인: 실제 브라우저 저장 지속성·계정전환·지연 WS 및 최신 빌드 필요.

## S03 — 개인 분석 복원·삭제와 프로젝트 멱등성 연결 (구현, 검증 대기)

- backend/pipeline/domain/chat/project_sessions.py: 개인 분석 소유권 검사/복원/삭제 함수 추가. 삭제는 AnalysisResult 본문에 한정하고 연결된 태스크/승인용 AnalysisSession 메타데이터는 보존. 익명/타사용자/ownerless 차단. 명시적 팀 공유 스냅샷 API는 유지.
- backend/transport/rest_handler.py: 복원/삭제에 인증·DB 의존성 연결, 실제 삭제 함수 사용. HTTP401/403/404를200으로 감추지 않음. 타임스탬프 정규식 제거로 UUID 분석ID 지원.
- project_sessions.create_project: 선택 client_request_id를 검증된 사용자/팀과 조합해 UUID5로 서버 프로젝트ID 생성. 기존 PK 유니크 제약이 동시 insert를 중재하며 충돌 후 동일 내용만 기존 결과 반환. 같은 키에 다른 제목409. 새 테이블/마이그레이션 없이 프로세스 재시작 후 재시도 유지. 키 없는 구버전 요청은 기존 UUID4 동작 유지.
- rest_handler.ProjectRegistrationRequest: 선택 필드 client_request_id(1~128자) 추가. 기존 필드/응답 형태 유지.
- sessionService.createProject와 sessionSlice.ensureServerSession: 안정적인 로컬 세션ID를 요청 키로 전달.
- test_session_access_boundary: 타사용자 삭제 차단/소유자 실제 삭제/삭제 후404/재삭제 성공 추가.
- test_project_idempotency.py 신규: 실제 REST+임시 SQLite로 동시 생성/재시도1건, 계정별 키 분리, 같은 키 내용 충돌 검증.
- 수정 전7개 중6개 실패 확인(복원/삭제4개 및 새 요청 필드422 2개). 테스트 기록은 실제 모델/원격 인증 검증과 구분.


## S04 — 원격 인증 및 GitHub·메뉴 구현 중간 기록

기록일: 2026-09-12. 사용자 공용 파일 변경 승인 유지. 전체 목표 미완료.

- backend/auth/remote_identity.py, backend/auth/deps.py: 데스크톱의 JWT 자체 검증 대신 원격 /auth/me로 검증. 팀 조회도 원격 권한 기준으로 확인하며 공유 서명키/로컬 User 복사 없이 요청 중 RemoteUser 사용. 원격 장애503, 만료401, 권한 부족403 구분. auth 모드 local은 명시적 테스트 환경용.
- backend/pipeline/domain/chat/memo_approval.py, backend/pipeline/domain/agile/manual_tasks.py, backend/pipeline/domain/agile/nodes/task_distributor.py: 저장 승인과 팀원 배정에서 동일한 원격 사용자·멤버십 확인. 로컬 전용 테스트 경로는 기존 ORM 사용.
- backend/orchestration/pipeline_runner.py: Idea Chat 모델 호출 전 인증/세션 접근 확인; 저장 시 요청 사용자 재검증. GitHub 토큰은 필요한 작업에서만 기존 서버 API로 조회하고 로컬 DB에는 복사하지 않음.
- src/App.jsx: 인증 서버 장애는 연결 재시도 화면. src/store/slices/githubSlice.js: 개인/팀 단위 저장소 선택 분리, 토큰은 메모리만 사용; legacy 설정 보존.
- server/routers/auth.py: Device Flow의 설정 출처는 서버 GITHUB_CLIENT_ID. 잘못된 연결용 JWT는 교환 전401, 타 계정 GitHub 강제 연결 이전409, 이메일 동일성만으로 계정 병합 금지409, GitHub 사용자 조회 실패502 및 DB 미변경. 새 GitHub 사용자 역할 software_engineer. 응답 status=ok 추가, 기존 access_token/user 계약 유지. 네트워크 제한시간과 응답 검증, DB 충돌 rollback. 서버 배포는 하지 않음.
- src/store/slices/authSlice.js: 성공 응답 계약 통일, 인증 시도별 취소/만료/현재 계정 검증, 중복 폴링 억제 및 slow_down 간격 증가. 계정 전환 중 팀 생성 응답 무시.
- src/store/slices/sessionSlice.js: 늦은 메모 응답 검사에 authGeneration 추가.
- src/components/auth/LoginScreen.jsx: 실제 서버와 무관했던 로컬 /auth/setup-oauth 입력 및 Client Secret 입력 제거. 서버 공통 OAuth 설정 안내 제공. 취소/화면 이탈 후 늦은 인증 결과 차단.
- src/components/SettingsPanel.jsx: Device Flow setInterval 중첩을 순차 setTimeout으로 변경하고 취소/화면 이탈 시 진행 중 시도 무효화. 기존 팀 설정 API는 유지; 공통 로그인 OAuth와 별도임.
- src/components/HomeScreen.jsx, src/components/ui/AnchoredPopover.jsx: 첨부 + 메뉴를 body portal로 표시, 버튼 위치와 뷰포트 경계로 위/아래 선택, 높이 제한과 내부 스크롤, Escape/외부 클릭 닫기, resize/scroll 재배치.

검증 근거:

- server에서 `..\backend\.venv\Scripts\python.exe -B -m unittest discover -s test -p test_device_flow_boundary.py`: 7개 통과. 수정 전 5개 실패/2개 통과. 실제 라우터+임시 SQLite, GitHub HTTP만 대체. 실제 GitHub 승인/원격 배포 검증 아님.
- 루트에서 `node --experimental-vm-modules --test backend/pipeline/domain/chat/test/github_device_flow.test.mjs backend/pipeline/domain/chat/test/memo_store.test.mjs`: 21개 통과. GitHub 프런트 새 6개는 수정 전 모두 실패. 실제 store 모듈, 원격 HTTP/시계/브라우저 저장소 대체.
- 메뉴 검증용 browser/menu.html 및 menu.jsx 추가: 실제 HomeScreen에 합성 대화만 제공. 제품에 mock 백엔드를 연결하지 않음. 별도5198 포트에서 브라우저 검사.
- 1024x600에서 수정 전 메뉴 y=563.2/bottom=730.6으로 화면 밖. 수정 후 y=347.2/bottom=514.6으로 화면 안. 레포 선택 뷰 전환 및 Escape 닫기 확인.
- 125% CSS 확대 검증은 도구 시간초과로 확인 미완료. 150%, 더 작은 창, 실제 Electron 확대, 전체 최신 빌드와 회귀는 추가 검증 필요. 통과로 간주하지 않음.
- 추가 변경 전 Chat 전체42 중 memo_runner fixture 오류1건은 fixture 수정 후 관련6개 재실행 통과했으나 전체 최신 재실행 필요. 이전 Agile50/프런트34/빌드 성공 결과를 이후 GitHub·메뉴 변경 전체에 대한 증거로 사용하지 않음.

데이터/되돌리기:

- 실제 사용자 DB, .env, Cloud 설정과 계정은 수정하지 않음. 이전 데이터 자동 귀속/삭제 없음.
- 이번 변경 원본은 repair_baseline_20260911/manifest.json 및 대응 파일에 별도 보존. 기존 dirty 변경이 있으므로 git 전체 복원 금지. 작업별 diff만 되돌리고 이후 사용자 변경과 대조할 것.
- 남은 검토: 기존 engineer/qa 역할 호환성, 늦은 WS 및 다른 비동기 응답 경로, 팀 공유 회귀, 실제 로그인/VM 연결, GitHub 설정·배포 절차.
- Device Flow 기준: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps (slow_down 시 최소 간격5초 증가, Client Secret 불필요).

## 환경 변경 — Cloud Run에서 Compute Engine VM으로 전환 (2026-09-12)

- 사용자 제공 화면: project-455fe773-f744-4e97-b0a / us-central1-a / instance-20260912-104329. VM SSH 터미널 프롬프트가 보여 브라우저 SSH 연결은 이미 성공한 상태.
- 화면상 외부 IP는 없고 내부 IP 10.128.0.2. 원격 앱 접속에는 별도 연결 경로가 필요. 브라우저 SSH 성공과 NAVIGATOR 백엔드 실행 성공은 구분한다.
- 이후 환경 안내는 VM을 기준으로 갱신한다. 기존 소스에 남은 Cloud Run URL을 아직 VM 주소로 변경하지 않음. VM 서버 설치/실행/주소/접속 방식과 DB 위치를 먼저 확인해야 한다.
- 이 기록에서 VM 접속·소프트웨어 설치·방화벽 변경·배포·유료 리소스 생성은 실행하지 않았다.

## S05 — 최신 변경 커밋 전 회귀 검증 (2026-09-12)

- 사용자 요청: 최신 작업을 security/agile-chat-write-gate 브랜치에 push.
- 기준 HEAD 및 확인한 원격 브랜치: b9332f82af31f81d963ab7c5653bfd1a48496ade.
- backend: .\.venv\Scripts\python.exe -B -m unittest discover -s pipeline/domain/agile/test -p 'test_*.py' — 50개 통과.
- backend: .\.venv\Scripts\python.exe -B -m unittest discover -s pipeline/domain/chat/test -p 'test_*.py' — 42개 통과.
- backend: .\.venv\Scripts\python.exe -B -m pytest pipeline/domain/dev_tracking/test/unit/test_task_coordinator.py -q -p no:cacheprovider — 1개 통과.
- server: ..\backend\.venv\Scripts\python.exe -B -m unittest discover -s test -p test_device_flow_boundary.py — 7개 통과.
- 루트: node --experimental-vm-modules --test backend/pipeline/domain/chat/test/*.test.mjs backend/pipeline/domain/agile/test/*.test.mjs — 40개 통과.
- npm run build — 1724 modules, 33.27초 성공. 기존 번들 크기/혼합 import/Browserslist/plugin timing 경고 유지.
- git diff --cached --check 통과. storeHelpers.js의 후행 공백 3곳만 정리.
- 실행 로그, 개인 START_PROMPT.md/skill.md/spec.md, 운영 DB 및 .env는 커밋에서 제외.
- 실제 원격 로그인/GitHub 승인/VM 배포 및 P6 완료를 의미하지 않음. 앞선 기록의 시점별 미완료 항목은 이 검증 범위에서만 갱신.