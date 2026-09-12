# 전성빈 — AGILE-SEC 변경 이력 및 인수인계

기록일: 2026-09-07. 대화의 작업 기록과 현재 파일/Git 상태를 대조하여 작성했다.
이 문서는 구현 변경 기록이며 AGENTS.md나 팀 Spec의 권한 규칙을 대체하지 않는다.

## 다음 작업 시작 시 확인
1. AGENTS.md와 협업 Spec을 먼저 읽고 이 문서를 읽는다.
2. 현재 branch, HEAD, status를 확인한다. 아래 기록과 달라진 파일은 실제 diff로 확인한다.
3. 기존 수정/미추적 파일을 보존한다. 기록된 이전 테스트 성공을 새 변경의 성공 근거로 재사용하지 않는다.
4. 작업 후 변경 이력 항목을 추가하고 현재 상태·검증·미완료 항목을 갱신한다.
5. API 키, 토큰, 비밀번호, .env 내용은 이 문서나 테스트 로그에 기록하지 않는다.

## 저장소 및 현재 상태
- 로컬 루트: C:\Users\jsb46\Generative_AI\NAVIGATOR_ver1
- 원격: https://github.com/xxriny/Navigator.git
- 패키지/담당: AGILE-SEC / 전성빈
- 기준 main: ae43fe9ae119629cbfc9cbaa1f55c15babede926
- 작업 브랜치: security/agile-chat-write-gate
- 현재 HEAD: b9332f82af31f81d963ab7c5653bfd1a48496ade
- 이 HEAD는 대화 중 origin 동일 브랜치에 push하고 SHA 일치를 확인했다. 매번 원격 상태를 재조회해야 한다.
- b9332f8 이후 후보 검증 모듈·테스트·인수인계 문서는 로컬 미커밋 상태다.
- 커밋 작성자 설정과 GitHub 인증 계정은 별개이며, push 당시 jsb0816의 권한을 확인했다.
- main 병합, rebase, PR 생성은 수행하지 않았다.

## 담당 범위 및 승인 기록
- 초기 요청: 태스크 생성 전 승인, 기존 자동 수정 제한, 메모 저장 확인, Wiki·문서 쓰기 승인.
- 최근 팀 분담표: task_generator.py, idea_chat.py, pipeline_runner.py, Agile/Chat 전용 테스트. 보안 태스크 누락 방지와 거절 태스크 후속 분석/지식 제외도 포함.
- pipeline_runner.py는 담당자 A의 목록에도 있어 명시적 중복 파일이다.
- 최근 분담표에는 Wiki·문서 발행 승인이 명시되지 않아 기존 요구와 범위 정합성 확인이 필요하다. 이전에 만든 후보 모듈을 삭제하거나 확장하지 말고 확인한다.
- 사용자는 팀원 승인 없는 공용/담당 외 파일 수정 금지를 명시했다.
- 사용자는 '검토 받았어'라고 했지만 승인 파일 범위 확인에는 상세 설명을 요청했다. 공용 변경 전면 승인이 확정됐다고 기록하지 않는다.
- '팀원이 합의했다 치면'은 가정에 대한 파일 목록 요청이며 실제 승인으로 보지 않는다.
- 공용 API/Runner/Connector/프런트, task_coordinator, Dev Tracking 파일은 지금까지 수정하지 않았다.

## 변경 001 — 생성기 즉시 쓰기를 제안 반환으로 분리
상태: 커밋 및 push 완료 (b9332f8).

### backend/pipeline/domain/agile/nodes/task_generator.py
문제: 모델 결과로 신규 태스크를 즉시 저장하고 기존 unassigned 태스크 내용을 자동 변경했다.

변경 내용:
- create_task, update_task_status import 및 호출 제거. list_tasks 조회는 유지.
- 입력 데이터는 지시가 아니며 모델이 저장/승인을 선언하지 말아야 한다는 프롬프트 경계 추가.
- run_task_generator의 기존 인자 유지. created_by는 호환성 때문에 유지하며 승인 증거로 사용하지 않는다.
- 빈/공백 team_id는 ValueError로 거부하여 전체 팀 조회로 흘러가지 않게 함.
- 모델 파싱 실패는 기존 '0개 생성' 정상 반환 대신 ValueError. 기존 REST try/except가 오류 응답으로 전달 가능.
- 신규 후보의 기존 feature_ref 및 정규화 제목 중복 검사와 배치 내부 중복 차단 유지.
- task_proposals: task_type/title/description/area/feature_ref/effort/priority만 반환. DB id, 승인 상태는 생성하지 않음.
- update_proposals: 조회 당시 미할당 ID만 허용. 실제 다른 값만 changes로 반환. 무변경·중복 수정안 제외.
- 각 수정안에 before, expected_status, expected_updated_at, reason 포함. 버전은 향후 승인 적용 시 재검증해야 하며 지금 갱신을 보호하는 락은 아님.
- 기존 created/updated는 0, tasks는 빈 목록으로 유지.
- proposal_status를 awaiting_approval/no_changes로 구분하고 skipped_updates 추가.
- summary는 실제 후보 수와 '저장 및 수정 없음'으로 구성. 모델의 저장 완료 주장 사용하지 않음. thinking은 여전히 비신뢰 모델 설명.

한계:
- 화면과 승인 후 저장 API는 미연결. 현재 화면은 created 값만 보므로 변경된 서버 사용 시 0개 추가로 보일 수 있다.
- list_tasks는 내부 init_tasks_db를 호출한다. 태스크 생성/수정 차단을 DB 접근·스키마 초기화가 전혀 없다는 의미로 확대하지 않는다.
- 새 후보의 사실성·전체 허용 값 검증, 모든 태스크 변경 경로 차단은 완료하지 않았다.
- 거절 태스크의 동일 ref/제목 재생성은 중복 검사 대상이지만 의미상 우회 재생성과 후속 RAG 제외 전체는 미완료.

### backend/pipeline/domain/agile/test/test_task_proposals.py
- unittest와 mock으로 LLM/list/create/update를 격리. 운영 DB·실제 모델 호출 없음.
- 7개: 신규 승인 위조 출력, 기존 수정안만 반환, 중복/거절 태스크, 잘못된/활성 ID, 무변경/중복 수정안, 파싱 실패, 정상 빈 결과.
- 수정 전 5 failures + 2 errors 확인. 실제 create/update 호출 실패와 새 계약 필드 부재가 포함됨.
- 수정 후 7개 통과. push 전 재실행에서도 7개 통과.
- 이 결과는 동적 모델 인젝션 성공률 측정이 아니다.

## 변경 002 — 메모 후보 순수 검증 모듈
상태: 로컬 미커밋. 실제 idea_chat/Runner에 연결하지 않음.

### backend/pipeline/domain/chat/memo_candidates.py
- frozen dataclass MemoCandidate: session_id/text/section/detail.
- text 200, section 60, detail 4000자 제한. 검토 내용이 바뀌지 않도록 초과 시 잘라내지 않고 거부.
- session_id/text/section은 비어 있을 수 없음. detail은 빈 문자열 허용.
- prepare_memo_candidates: dict 목록만 허용. 한 항목이라도 잘못되면 전체 호출 실패. 빈 목록은 빈 tuple 반환.
- session_id는 호출 인자에서 받음. 모델의 approved/actor/session_id 등의 추가 필드는 채택하지 않음.
- 모든 필드가 같은 후보만 중복 제거. 같은 제목이라도 상세가 다르면 별도 후보.
- 정확한 입력 공백/본문 보존, 불변 tuple 반환.
- memo.create.v1 + 프로젝트 + 내용의 SHA-256 fingerprint 제공.
- fingerprint는 누구나 계산 가능하다. 인증·서명·승인 토큰으로 사용하면 안 된다.
- 사용자/세션 소유권, 승인 만료, 저장, 반복 요청 방지는 구현하지 않음.

### backend/pipeline/domain/chat/test/test_memo_candidates.py
6개: 내용/대상 보존·불변성, 모델 승인/대상 필드 무시, 내용/대상 변경 지문, 잘못된 배치 거부, 세션/배치 형식, 전체 내용 기반 중복.

## 변경 003 — 문서 발행 후보 순수 검증 모듈
상태: 로컬 미커밋. Publisher/Connector/화면에 연결하지 않음.

### backend/pipeline/domain/agile/publish_candidates.py
- frozen dataclass PublishCandidate: owner/repo/mode/page_title/markdown/expected_revision.
- owner/repo는 빈 값, 경로 구분자, 공백·일부 제어 문자 등을 거부하는 단일 경로 조각 검사. GitHub 저장소 존재·권한 검증을 대신하지 않음.
- mode는 wiki/issue만 허용하며 미지원 값을 Wiki로 자동 변환하지 않음.
- 제목·본문은 필수, 최종 Markdown을 변경하거나 LLM으로 재생성하지 않음.
- document.publish.v1 + 모든 검토 필드의 SHA-256 fingerprint 제공.
- expected_revision 빈 값은 '미확정'이며 대상이 신규라는 근거가 아님.
- 저장소 권한/외부 버전 조회/실제 발행/승인/재사용 방지는 포함하지 않음.

### backend/pipeline/domain/agile/test/test_publish_candidates.py
6개: 본문 불변성, 모든 필드 변경 지문, 발행 모드 거부, 필수 값, 대상 경로 조각, 지문 결정성/승인 아님.

## 변경 004 — 연결안 문서
### backend/pipeline/domain/agile/WRITE_APPROVAL_HANDOFF.md
상태: 로컬 미커밋.
후보 지문과 승인 증명의 차이, 공용 파일별 최소 변경, Dev Tracking 호환성, 저장 실패/타임아웃/재사용 테스트 과제를 기록했다.
구현·연결 완료 문서가 아니라 검토용 제안이다.

## 테스트 기록 및 재실행 방법
작업 디렉터리: backend. 다음 명령은 당시 테스트 실행 기록이다.

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONIOENCODING='utf-8'
.\.venv\Scripts\python.exe -m unittest discover -s pipeline/domain/chat/test -p test_memo_candidates.py -v
.\.venv\Scripts\python.exe -m unittest discover -s pipeline/domain/agile/test -p 'test_*.py' -v
```

마지막 코드 검증 결과: Chat 6 + Agile 후보 6 + 기존 태스크 7 = 19개 통과.
새 후보 모듈의 구현 전에는 ModuleNotFoundError를 확인했으며, 이것을 기존 앱 공격 재현 증거라고 주장하지 않는다.
기존 전체 파이프라인, UI 통합, 실제 GitHub, DB 실패 주입 테스트는 미실행이다.
이번 변경 이력 문서 작성 시 테스트를 재실행하지 않았으며 위 결과는 이전 실행 기록이다.

## 환경 준비 및 문서 변경 기록
- 저장 경로를 처음 잘못 해석한 Generative\_AI\NAVIGATOR\_ver1에서 올바른 Generative_AI\NAVIGATOR_ver1로 수정. 잘못된 경로의 지침 4개는 사용자 요청으로 삭제.
- 올바른 루트에 개인 AGENT.md/skill.md/spec.md/START_PROMPT.md 생성. 이후 사용자 요청으로 개인 AGENT.md 삭제하고 팀 AGENTS.md 유지, 개인 문서 참조 수정.
- 협업 Spec 경로를 docs/specs/llm-injection-collaboration.md로 통일하고 사용자 제공 분담 내용을 로컬 파일로 생성. .gitignore의 DOCS 규칙에 의해 무시됨.
- npm ci로 node_modules, Python 3.12 기반 backend/.venv 및 requirements 의존성 설치. package-lock/requirements는 변경하지 않음.
- backend/.env에 Gemini 설정 생성. 값은 기록하지 않음. Git 추적 제외 확인. 사용자 승인으로 짧은 모델 호출 1회 성공 및 has_api_key 확인.
- Vite/Electron 실행 및 로그 생성. PID/포트는 재시작 때 바뀌므로 이전 값을 그대로 사용하지 않는다.
- 루트 실행 로그와 개인 지침은 앞선 코드 push에 포함하지 않음.
- 준비 과정의 이전 작업공간 local-setup 및 navigator-clone-prep 사본은 현재 주 작업 저장소가 아니다.

## 미완료 및 보류
- 승인 UI, 서버 승인 증명/권한/만료/재사용 검사, 원자적 저장, 쓰기 실패 결과 처리.
- 실제 메모 자동 저장 및 문서 발행은 현재 그대로. 후보 모듈 추가만으로 차단되지 않는다.
- Wiki/Issue API 실제 지원, 조회 오류 분기, 외부 버전 충돌과 타임아웃 후 중복 방지.
- 필수 보안 태스크 규칙 및 검증, 거절 태스크 후속 분석/지식 제외.
- 원격 인증 서버의 /health 및 인증 사전 요청에서 404/CORS 헤더 없음 확인. 당시 로컬 백엔드는 정상. 서버 복구 여부는 미확인.
- 최신 팀 분담에 따른 Wiki 범위 및 중복 Runner 수정 구간 합의.

## 앞으로 추가할 변경 항목 양식
- 날짜/작업 ID/요청과 승인 근거:
- 작업 전 branch/HEAD/status:
- 정확한 파일 경로/담당자/겹치는 호출자:
- 변경 전 문제/변경한 함수와 필드/변경 후 동작:
- API·UI·DB 호환성 및 부작용:
- 테스트 명령/수정 전 결과/수정 후 결과/격리 방식:
- 미검증/위험/보류/다음 과제:
- 커밋 SHA/push 여부/원격 확인:
- 코드에 없는 제안은 제안이라고 명시:

## 변경 005 — 구현 계획 기록 (2026-09-07)
- AGILE_SEC_IMPLEMENTATION_PLAN.md 신규 작성: P0~P6 작업 순서, 최신 분담/승인 경계, 보안 적용 조건, 거절 태스크 격리와 중복 식별 정보 구분, 메모/문서 승인 계약, 테스트·완료 기준.
- 계획은 구현이나 공용 변경 승인 증명이 아니다. 새 테스트 실행·소스 변경·commit/push 없음.
- 특히 신규 생성 승인과 기존 pending_approval 개발 상태를 구분하고, 메모 후보의 LangGraph state 전달 및 공용 Runner 변경 필요성을 명시했다.

## 변경 006 — P0 기준선 및 P3 거절 컨텍스트 격리 (2026-09-08)
- 요청: P0~P5 진행, P6은 Dev Tracking 협의 전 보류. 현재 브랜치 security/agile-chat-write-gate, HEAD b9332f8. 기존 미추적 파일 보존.
- P0 재실행: Agile 13 + Chat 6 = 19개 통과. 모델과 태스크 조회/쓰기 mock, 후보 모듈 순수 단위 테스트. 통합 DB 격리 검증은 아직 미완료.
- backend/pipeline/domain/agile/test/test_task_proposals.py: 거절 태스크 제목/본문/ref/담당자가 실제 call_structured의 user_msg에 없는지, 정상 태스크는 유지되는지, 거절 제목 재생성은 차단되는지 검증 추가.
- 수정 전 해당 테스트는 REJECTED_ATTACK_MARKER가 모델 입력에 포함되어 assertion 실패. import 실패가 아닌 실제 입력 경로 재현.
- backend/pipeline/domain/agile/nodes/task_generator.py: _build_user_msg의 COVERED에서 rejected 제외. 프롬프트의 전체 상태/ground truth 설명을 실제 비신뢰·비거절 컨텍스트에 맞춰 수정. 기존 서버 existing_refs/existing_titles 전체 상태 중복 검사는 유지. 함수 서명/응답/DB 모델 변경 없음.
- 수정 후 unittest discover -s pipeline/domain/agile/test -p test_*.py: 14개 통과. Chat 동일 명령 경로 chat/test: 6개 통과. 총 20개. 테스트 실행 위치 backend, backend/.venv Python 사용, PYTHONDONTWRITEBYTECODE=1.
- 담당 외 소스 변경 없음. P3의 생성기 경계만 검증 완료; 후속 분석/RAG 경로 전역 차단, P1/P2/P4/P5 연결은 미완료. 실제 모델 공격 성공률 및 운영 DB 통합을 검증한 결과가 아님.
- commit/push 하지 않음. 변경 기록은 기존 이력에 추가.

## 변경 007 — P1 태스크 후보 필드 검증 (2026-09-08)
- task_generator.py에 _validate_proposal_fields 추가. 기존 GeneratedTask의 허용 enum과 AgileTask.title(255)/feature_ref(64) 컬럼을 기준으로 검증. description 16000, reason 2000은 신규 검토용 입력 상한이며 DB 제약을 의미하지 않음.
- 신규 후보: 비어 있는 제목/설명, 길이 초과, NUL, 잘못된 유형/영역/우선순위/공수, RTM plan.requirements_rtm의 id에 없는 비어 있지 않은 feature_ref를 ValueError로 거부. 빈 ref는 기존 계약 유지. RTM에 존재한다는 검사는 상위 요구사항의 진실성을 보증하지 않음.
- 수정 후보: 실제 변경 필드와 reason 검증. 기존 대상 ID/상태/중복 검사는 유지. 검증 오류 시 일부 후보를 성공 응답으로 반환하지 않음. 원본 문자열을 잘라내거나 정규화하지 않음.
- test_task_proposals.py: 잘못된 신규 9개/수정 6개 subcase에서 수정 전 ValueError 미발생 실패 확인. 유효 RTM 참조·정확한 공백 포함 본문 보존 정상 사례도 추가. 수정 후 Agile 17 + Chat 기존 6 = 23개 통과.
- 기존 API 시그니처/공용 schema/DB 변경 없음. 의미상 중복과 실제 요구사항의 충족 여부는 이 필드 검증만으로 보장되지 않음.

## 변경 008 — P4 Chat 후보 검증 런타임 연결 (2026-09-08)
- memo_candidates.py: validate_memo_content 공개 함수 추가. 기존 불변 MemoCandidate도 같은 검증을 호출하여 본문 상한을 일원화. 대상·권한·승인은 별도 검증 필요.
- idea_chat.py: _normalize_notes_to_add는 dict 목록을 정확한 내용으로 검증하고 완전히 동일한 후보만 중복 제거. 잘라내기/strip/문자열 자동 변환 제거. 자유 형식 fallback의 notes_to_add는 항상 빈 배열.
- test_idea_chat_candidates.py 신규: 실제 idea_chat_node를 fake LLM으로 호출. fallback 위조 메모, 제목/섹션/본문 초과 3개, 공백·개행 보존 및 중복 제거에서 수정 전 총 5개 assertion 실패 확인. 일반 대화 정상 사례 포함.
- 수정 후 Chat 10개 통과. 운영 모델 호출 없음. Node 테스트가 Runner의 DB 쓰기 차단을 증명하지는 않음. 모델 reply는 저장 영수증이 아니며 UI의 실제 저장 결과 표시는 P5에서 연결해야 함.
- P4는 후보 처리까지 적용. 현재 Runner의 정상 구조화 후보 자동 저장은 아직 남아 있으므로 승인 전 저장 차단 전체 완료로 보고하지 않음. 프롬프트의 기존 자동 저장 설명도 P5 사용자 흐름과 함께 정리 필요.
- 작업 범위 Agile/Chat 소스·전용 테스트 및 이 기록. 기존 미추적 파일 보존. P2 규칙/신뢰된 적용 조건, P3 후속 수집 경로, P5 권한·트랜잭션·UI 미완료. P6 보류. commit/push 없음.

## 변경 009 — P5 메모 승인 저장의 Runner/API/UI 연결 (2026-09-08)
- 승인 근거: 사용자의 목표 P0~P5 진행 요청. P5에 필요한 Runner/API/화면 구간만 변경. P6·DEV-SEC·PM/SA 노드·공통 LLM·DB 모델은 변경하지 않음.
- backend/pipeline/domain/agile/approval_store.py 신규: 단일 프로세스 메모리 후보 저장소. UUID 제안/항목 ID, 사용자/프로젝트/팀/종류 결합, 기본 15분 만료, 최대 100항목/1000제안, 깊은 복사, 선택 검증, 취소, 성공 결과 동일 요청 재반환, 실행 실패 outcome_unknown으로 무조건 재실행 금지. 미승인 후보 DB 저장 없음. 재시작하면 기존 ID 무효. ID 자체는 권한 아님.
- backend/pipeline/domain/chat/memo_approval.py 신규: 인증된 사용자와 AnalysisSession 소유권/TeamMember 현재 소속 확인. 소유권 없는 로컬 세션은 추측하지 않고 거부. 후보 발급은 읽기만 수행. 승인/재시도/취소마다 권한 재검사. SQLite BEGIN IMMEDIATE 이후 재검증/정확한 본문 중복 검사/선택 배치 저장; flush와 commit 성공 후 실제 UUID 반환. 예외 rollback, 실패 시 성공 영수증 없음.
- backend/orchestration/pipeline_runner.py: run_idea_chat의 직접 MemoItem add/commit 구간 제거. 유효 인증/프로젝트에 메모 제안 발급. notes_to_add는 구 클라이언트의 자동 저장 완료 해석 방지를 위해 빈 목록 유지. memo_proposal와 memo_proposal_error 응답 추가. 인증 실패 시 대화는 유지하되 메모 저장 없음.
- backend/transport/rest_handler.py: POST /api/memo-proposals/{id}/approve 및 /cancel 추가. get_current_user 필수. 승인 본문은 selected_ids만 허용(extra forbid). 모델 본문·approved·actor 등의 클라이언트 덮어쓰기 거부. 기존 수동 /api/memos와 DEV-SEC API는 아직 변경하지 않음.
- src/store/slices/pipelineSlice.js: Chat 응답의 메모를 userComments에 자동 합치던 코드 제거. memoProposals 별도 상태/dismiss 동작 추가. 후보는 기존 설계 업데이트 입력인 userComments와 분리. 현재 사용자 일치 확인 및 제안 알림.
- src/components/resultViewer/MemoProposalReview.jsx 신규: 본문/섹션/프로젝트/기한 표시, 기본 미선택, 항목 선택 저장·취소, 실행 중 중복 클릭 방지, 계정·프로젝트 변경 검사, Authorization 헤더. 성공 시 DB 목록 재조회, 실패 시 미저장 제안 유지/결과 확인 안내.
- src/components/resultViewer/MemoManager.jsx: 현재 사용자·프로젝트의 후보만 검토 카드 표시.
- backend/pipeline/domain/chat/idea_chat.py: 프롬프트의 저장 완료 주장 규칙을 미저장 후보/별도 승인으로 변경. 실제 저장 성공은 앱이 표시하도록 설명.
- test_memo_runner.py 신규: 실제 Runner에 mock pipeline/DB를 주입. 수정 전 자동 add 1회로 assertion 실패 재현, 수정 후 add/commit 0회 및 legacy notes_to_add 빈 목록 확인.
- test_memo_approval.py 신규: 실제 임시 파일 SQLite(운영 DB 사용 없음), 선택 저장/정확한 본문/발급 시 쓰기 없음/재전송/잘못된 사용자·선택/만료/취소/소유권·팀 소속 상실/commit 실패 rollback/선택 배치 중복 원자성/클라이언트 복사본 변조 차단. FastAPI TestClient 실제 라우터에서 401, 위조 필드 422, 정상 승인 200과 저장 내용 검증.
- 검증: Chat unittest discover 19개 + Agile 17개 = 36개 통과. npm run build는 성공(1721 modules, 36.89초). 기존 큰 번들/혼합 import/Browserslist 경고 있음. 이어 실행한 diff --check에서 rest_handler 추가 줄 CRLF를 trailing whitespace로 보고하여 LF 정리 후 재검증.
- 미완료: 실제 화면 클릭 통합/인증 서버 연동, 기존 수동 메모 API 쓰기 권한 및 실패 시 임시 항목 처리, 일반 Advisor 임시 메모 입력 경로, 태스크 승인 UI/API와 조건부 수정 트랜잭션, P2 필수 규칙, P3 후속 수집 경로. 단일 프로세스 메모리 설계이며 다중 worker 공유 저장소는 없음. HTTP 요청만으로 실제 사람이 클릭했음을 증명하지 않음.
- 공용 Runner/API 변경은 메모 경로에 한정했으며 다른 파이프라인 전체 회귀는 아직 미완료. commit/push 없음. 기존 파일 보존.
- 줄끝 최종 정리: 기존 rest_handler.py의 원본 줄끝 바이트를 유지하고 신규 API 추가 부분만 LF로 작성. 기존 API 본문이 HEAD와 동일함을 정규화 비교 후 확인하여 파일 전체 줄끝 변경을 제거함.


## 변경 010 — P5 태스크 승인 저장 연결 (2026-09-08)
- 요청/범위: 사용자 P0~P5 진행 승인에 따라 태스크 생성 API와 승인 API·화면 연결. DEV-SEC/PM/SA 노드와 DB 모델·기존 task_coordinator 공개 함수는 변경하지 않음. P6 보류.
- backend/pipeline/domain/agile/task_approval.py 신규: 생성 결과를 actor/run/team과 결합한 서버 후보 발급. 분석 결과 SHA256/RTM 참조 목록을 검토 컨텍스트에 보관. 해시는 승인 증명이 아니라 분석 변경 감지 수단. 매 승인/취소에서 현재 팀 PM 권한 재검사.
- 선택 배치 저장: SQLite BEGIN IMMEDIATE, 분석 내용 재검사, 신규 제목/기능 ref 중복 검사(거절 포함), 기존 태스크 ID/team/unassigned/updated_at/변경 전 필드 검사, 조건부 UPDATE 결과 1행 확인. 전부 성공하면 commit. 일부 충돌/예외는 신규 생성까지 rollback. 신규는 unassigned이며 별도 개발 착수 승인이 아님. created_by/reviewed_by는 인증된 사용자, 신규 analysis_id는 서버 프로젝트로 설정.
- backend/transport/rest_handler.py: generate_tasks_endpoint에 get_current_user와 현재 프로젝트 팀 PM 권한 추가. 저장된 PM plan/flattened result/PM data.rtm의 실제 입력 형태를 생성기용으로 정리. 본문의 created_by를 사용하지 않음. review_proposal 반환. /api/task-proposals/{id}/approve 및 /cancel 추가, ID 선택 외 필드 거부. 기존 다른 API 본문은 보존.
- src/components/resultViewer/TaskProposalReview.jsx 신규: 신규 본문·유형·영역·공수·우선순위·ref 및 기존 변경 전후·이유 표시. 기본 미선택, 선택 승인/취소/기한/오류, 현재 계정·팀·분석 대조. 성공 결과만 저장 완료 표시.
- src/components/resultViewer/TaskApprovalPanel.jsx: 생성 요청에 Authorization 추가. 생성 완료 개수 대신 미저장 제안 표시 및 검토 컴포넌트 연결. 승인 성공 후 태스크 재조회. 기존 소스 줄끝은 바이트 단위로 보존하여 파일 전체 포맷 diff 제거.
- src/components/resultViewer/MemoProposalReview.jsx: 기존 apiBaseUrl을 사용하도록 수정해 Electron/브라우저/설정된 API 주소와 일치.
- test_task_approval_api.py: 실제 HTTP 미인증 생성 요청은 수정 전 200으로 실패, 수정 후 401 통과. 운영 DB 대신 mock 사용.
- test_task_approval.py: 임시 파일 SQLite에서 발급 시 쓰기 없음, 선택 신규 저장/중복 승인, 선택 수정만 적용, 동시 상태/버전/내용/팀 변경 시 배치 rollback, 분석 변경/PM 권한 상실, 거절 ref 중복, commit 실패 rollback 검증. 새 서비스 테스트는 기존 앱 공격 재현과 구분.
- 검증: Agile unittest discover 24개 + Chat 19개 = 43개 통과. npm run build 1722 modules, 5.80초 성공. 기존 번들 크기/Browserslist/동적 import 경고 유지. diff --check 통과. 기존 파일/미추적 후보 보존, commit/push 없음.
- 미완료: P2 필수 보안 규칙과 적용 조건, P3 후속 분석/RAG 제외, 수동 태스크·메모 API 및 배분/Advisor 우회 경로 점검, 화면 실제 클릭 통합과 전체 공용 호출자 회귀. 실제 원격 인증 장애 환경에서 계정 연동 검증은 미완료. task_coordinator의 고정 DB 경로와 설정 기반 auth DB가 다른 배포 환경의 경로 일치도 후속 확인 필요.

## 변경 011 — P2 필수 보안 규칙과 PM 적용 범위 확인 (2026-09-08)
- backend/pipeline/domain/agile/security_rules.py 신규: 사용자 제공 기능별 보안 예시를 고정된 태스크 템플릿 11개로 구현. 로그인(요청 제한/인증 테스트), 비밀번호(해싱 및 로그인 규칙), JWT 검증, RBAC, 업로드 크기/MIME, 압축 해제 자원 제한, Webhook 서명/replay/secret 미설정 차단. 비적용 기능에 무조건 생성하지 않음.
- 적용 조건은 모델의 문장/제목에서 추론하지 않음. 인증된 팀 PM이 security_scope로 모든 RTM id와 __project__(공통/RTM 외 기능)의 적용 항목을 명시하고 scope_reviewed를 확인. 확인값은 사용자 검토 요청이며 암호학적 클릭 증명이 아님. 실제 요구사항에서 기능 자체가 누락된 경우 PM 확인이 필요하고 상위 입력의 진실성까지 보장하지 않음.
- task_approval.py: 발급 전 scope 완전성/허용 capability 검증, LLM 결과와 별도로 필수 보완 후보 추가. 같은 기능의 여러 항목은 payload.security(feature_ref, rule_id)로 식별하며 일반 태스크 feature_ref 중복 정책에 의해 제거되지 않도록 보완 태스크 feature_ref는 빈 값으로 저장. 실제 기능 연결은 security 메타데이터에 보존.
- 충족 검사는 프로젝트/규칙 식별 정보, 승인 경로 식별 정보, 거절 아님, 고정 템플릿의 정확한 내용 일치로 판단. 제목만 비슷하거나 모델이 완료를 주장하는 것은 근거가 아님. 이것은 필수 태스크 존재 검사이며 보안 구현 완료 판정이 아님. 기존 필수 항목이 거절됐다면 자동 재생성하지 않고 검토 필요 오류.
- 승인 트랜잭션의 마지막에 전체 필수 항목을 다시 검사. 필수 후보 일부 누락·기존 보안 기준을 제거하는 수정은 전체 배치 rollback. 기존 수동 API로 payload/상태 변경 가능한 경로의 추가 보강은 아직 미완료이며 이 단계만으로 전체 우회 차단을 주장하지 않음.
- transport/rest_handler.py GenerateTasksRequest에 security_scope/scope_reviewed 추가. PM 권한·분석 확인 후 모델 호출 전에 적용 범위를 검사. 미확인 요청은 422. 생성기는 실제 런타임에서 이 API 한 곳에서 호출됨을 rg로 확인(테스트 제외).
- src/components/resultViewer/SecurityScopeForm.jsx 신규: 각 RTM 기능과 프로젝트 공통 항목의 기능 선택/전체 확인, 분석·적용 선택 변경 시 재확인. 자동 추정 기본값 없음. TaskApprovalPanel.jsx는 미확인 생성 차단 및 해당 scope 전송.
- TaskProposalReview.jsx: 필수 보완 후보 표시 및 모든 필수 후보를 선택하기 전 저장 버튼 비활성화. 서버도 독립적으로 재검사.
- test_task_approval.py 추가: 수정 전 적용 범위 없는 생성 요청이 200으로 허용되어 assertion 실패 재현, 수정 후 422 및 모델 호출 0회. 비밀번호 3항목 보완/누락 선택 rollback/정상 저장 후 중복 보완 없음, 11규칙/비적용/잘못된 범위, 제목만 위장, 거절 재생성 차단, 모델 수정에 의한 보안 기준 제거 rollback 검증.
- 검증: Agile 30개 통과. npm run build 1723 modules, 6.39초 성공. 기존 번들 경고 유지. Chat 회귀 재실행 및 diff 검사 수행. 함수/규칙 테스트는 실제 모델 공격률 근거가 아님.
- 남은 작업: 기존 수동 메모/태스크 API 및 배분/Advisor 경로 보강, P3 후속 분석·지식 입력 추적, 실제 화면 클릭 통합, 공용 호출자 회귀와 최종 요구사항 감사. P6 보류. commit/push 없음.

## 변경 012 — 기존 메모 API와 프런트 미저장 입력 경계 (2026-09-08)
- transport/rest_handler.py: 기존 /api/memos GET/POST/DELETE 및 /api/memos/apply에 get_current_user와 프로젝트 소유권/팀 소속 검사 추가. 기존 get_db generator를 next로 소비하던 경로를 Depends 세션 관리로 변경. 수동 저장은 명시적인 인증된 사용자 POST에만 적용하며 Chat은 호출하지 않음. 본문/상한 검증, 추가 승인 필드 거부, 정확히 동일한 수동 메모 중복 재사용, commit 실패 rollback. 일괄 applied 처리는 모든 ID의 존재와 모든 프로젝트 권한을 먼저 검사하므로 타 프로젝트를 섞으면 부분 적용 없음.
- test_memo_approval.py: 수정 전 4개 미인증 경로가 모두 200이라 assertion 실패 재현. 수정 후 401. 정상 소유자 생성·조회·보관·삭제 200, 타 프로젝트 접근 403, 혼합 프로젝트 applied 요청 전체 거부, commit 실패 500 및 행 없음 검증. 실제 임시 파일 SQLite 사용.
- src/api/services/sessionService.js: 메모 관련 호출에 Authorization 전달(선택적 인자 추가), 조회 session_id URL 인코딩. 다른 서비스 호출 변경 없음.
- src/store/slices/sessionSlice.js: addComment/removeComment는 서버 성공 후만 userComments 변경. 실패·오프라인 후보를 실제 메모 목록에 넣지 않음. 실제 ID와 persisted=true 표시. 응답 후 프로젝트/토큰 일치 검사. syncMemos는 인증된 서버의 빈 목록도 반영하고 자동·임시 메모를 합치지 않음. 캐시 세션 복원 시 메모는 DB 재조회 대상으로 비움. markMemosApplied는 성공 여부 반환 및 실패 알림.
- src/store/slices/pipelineSlice.js: Advisor 결과를 userComments에 자동 삽입하던 경로 제거(추천은 분석 결과에 남음). 후속 분석은 persisted=true인 활성 메모만 사용. 서버 보관 성공 후에만 메모 보관 완료 알림.
- MemoManager.jsx: 수동 저장 실패 시 입력 폼/내용 유지. AgileImpactTab.jsx: 사용자 저장 버튼으로 발생한 여러 저장의 결과를 await하고 모두 성공해야 저장됨 표시. 부분 성공 후 재시도는 정확한 중복 재사용 API에 의해 중복 행 생성 제한.
- backend/pipeline/domain/chat/test/memo_store.test.mjs 신규: 실제 sessionSlice/pipelineSlice ES 모듈을 Node VM에서 로드하고 서비스만 mock. 수정 전 저장 실패/대기 메모 노출·빈 서버 결과 무시·Advisor 자동 삽입 4개 실패, 프로젝트 전환 지연 응답 1개 통과. 수정 후 5개 전부 통과. Node --experimental-vm-modules --test backend/pipeline/domain/chat/test/memo_store.test.mjs (repo root).
- 검증: Chat Python 21 + Agile Python 30 = 51개 통과. 프런트 스토어 5개 별도 통과. npm run build 1723 modules, 41.52초 성공. diff --check 통과, 기존 줄끝 보존. 기존 번들/동적 import/의존성 deprecation 경고 유지. commit/push 없음.
- 다음 필수 과제 발견: UI currentSessionId와 분석 run_id가 별도이고 Runner _persist_result는 AnalysisSession(run_id)만 생성해 소유자/팀이 없을 수 있음. 현재 권한 검사는 이런 세션을 거부하므로 정상 프로젝트 초기화/연결 흐름을 구현·검증해야 전체 완료 가능. 기존 orphan 프로젝트를 임의 소유자로 귀속하지 않음.
- P3 추가 조사: Agile generator는 거절 본문 제외, distributor 입력은 unassigned 필터. Dev Tracking task_flow는 중복 승인 태스크 조회 목적으로 list_tasks를 사용함; RAG 적재와 연결되는지 추가 추적 필요. 해당 팀원 파일은 수정하지 않음.
- 남은 범위: 프로젝트 소유권/ID 연결, 수동 태스크/배분 API 경계, P3 후속 지식 경로, 실제 화면 통합과 공용 호출자 회귀, 최종 P0~P5 감사. P6 계속 보류.

## 변경 013 — 서버 프로젝트 ID와 분석 소유권 연결 (2026-09-08)
- 문제 근거: UI createSession은 Date.now 문자열을 local id로 사용하고 Runner는 별도 시간 기반 run_id를 생성. 기존 _persist_analysis_result는 AnalysisSession(run_id)만 넣어 created_by/team_id가 비어 있음. 권한 검사를 우회하지 않고 정상 등록 흐름을 추가.
- backend/pipeline/domain/chat/project_sessions.py 신규: 서버 UUID 프로젝트 등록, 인증 사용자 및 요청 팀의 실제 TeamMember 검증. 기존 orphan/타인 분석을 가져오지 않음. persist_owned_result는 검증된 프로젝트에서 별도 실행 AnalysisSession/AnalysisResult에 소유권을 복사하고 모델의 run_id/project_session_id를 서버 context로 덮어씀. 기존 실행 ID 재사용/덮어쓰기 거부, 실패 rollback.
- transport/rest_handler.py: POST /api/projects, GET /api/projects/{id}. 사용자/ID 필드는 서버 결정, 클라이언트 owner override 422. 기존 프로젝트는 접근 권한 검증 후 조회만 가능. 기존 데이터 일괄 귀속·삭제·이동 없음.
- orchestration/pipeline_runner.py: run_analysis 시작 전 인증/프로젝트/PM 역할 및 팀 PM 권한 확인. 매 실행 UUID 사용. 모델 단계 간 run_id를 요청 핸들러 값으로 복원. _run_pipeline_base에 별도 persistence_context 추가(모델 state 외부)하고 저장 성공 후에만 result 전송. _persist_analysis_result는 소유권 검증을 포함한 commit 결과를 반환하며 실패를 로그만 남기고 성공 처리하지 않음. run_idea_chat은 save=False 유지.
- src/api/services/sessionService.js: 서버 프로젝트 생성/조회 함수 추가.
- src/store/slices/sessionSlice.js: serverSessionId를 로컬 세션 메타데이터에 저장. ensureServerSession은 기존 ID 권한 확인 또는 신규 등록, 동시 요청 결합, 응답 후 계정/로컬 세션 변경 검사. 기존 분석은 project_session_id 또는 run_id 권한을 확인하며 실패해도 다른 프로젝트로 몰래 재등록하지 않음. 새 프로젝트/복원 시 서버 ID 초기화·복원. 메모 생성/조회는 실제 서버 ID 사용.
- src/store/slices/pipelineSlice.js: startAnalysis/runSyncUpdate/sendIdeaChat은 서버 프로젝트 확인 후 요청. 분석 요청 project_session_id와 Chat session_id를 서버 ID로 전송. 로컬 화면 세션 ID 및 별도 분석 실행 ID의 의미는 유지.
- MemoManager/MemoProposalReview: 후보 표시와 현재 프로젝트 검사는 serverSessionId로 대조.
- test_project_sessions.py 신규 7개: 프로젝트/실행 ID 분리와 owner 보존, 모델 ID 위조 덮어쓰기, orphan/타인 소유권 가져오기 거부, 팀 가입·PM 상실, commit 실패 시 실행 orphan 없음, 등록 API 401/422/200, Runner 실패 시 error만 전송. 실제 run_analysis → PM/SA mock stream → persistence → WebSocket result 경로를 임시 DB로 검증.
- memo_store.test.mjs: 신규 로컬 프로젝트가 서버 ID를 받고 메모에 사용하는지, 기존 소유권 없는 분석은 확인 실패 후 자동 재등록되지 않는지 추가. 기존 저장 테스트는 검증된 서버 프로젝트 fixture 사용.
- 검증: Chat 전체 27개 통과 후 추가된 전체 Runner 흐름을 포함한 프로젝트 테스트 7개 통과. Agile 30개 통과. 프런트 스토어 7개 통과. npm run build 1723 modules, 8.54초 성공. diff --check 통과. 실제 모델/원격 서버와 운영 DB 테스트 아님.
- 호환성 변경: 분석 WebSocket 요청에 project_session_id가 필수. 현재 프런트 호출자 2개 연결. 기존 클라이언트/공용 테스트/REST executor 등 다른 호출자는 최종 회귀에서 추가 확인 필요. UUID run_id를 사용하는 저장·조회 경로도 추가 감사 대상.
- 남은 범위: 수동 태스크/배분 API 우회, P3 후속 지식 경로, 다른 파이프라인 호출자 회귀, 실제 화면 통합 및 P0~P5 최종 감사. 소유권 없는 기존 프로젝트의 데이터 이관은 임의 수행하지 않음. P6 보류. commit/push 없음.


## 변경 014 — 수동 태스크 API 권한·상태·내용 검증 (2026-09-08)
- 요청 근거: 사용자의 P0~P5 진행 및 변경사항 상세 기록 요청. 브랜치 security/agile-chat-write-gate / HEAD b9332f8 유지. P6과 DEV 소스는 변경하지 않음.
- backend/pipeline/domain/agile/manual_tasks.py 신규: 실제 TeamMember로 권한 검사, 수동 생성 PM 제한, title/description/area/type/effort/assignee 필드 검사. 클라이언트 created_by는 권한 근거로 사용하지 않고 서버 사용자 ID 기록. 수동 payload로 보안/승인/실행 메타데이터 위조 차단.
- 수동 변경은 팀·태스크 유형·현재 상태·expected_updated_at 검사. 일반 본문/담당자 변경은 PM 권한 필요. 실제 담당자는 자신의 pending_approval 태스크 수락 또는 사유를 포함한 거절, 진행 상태 전환만 가능. 다른 사람의 태스크나 내용/담당자 변경은 거부. 중복 이름의 담당자는 임의 선택하지 않음.
- 거절 제목의 중복 생성 차단, 필수 보안 기준의 일반 수정 금지. 삭제는 PM의 완료된 일반 태스크만 허용하고 거절·필수 보안 기록은 보존. 삭제 요청에도 기준 버전 필수, 없거나 현재와 다르면 409.
- SQLite BEGIN IMMEDIATE 후 현재 태스크 재조회/검증과 쓰기. commit 실패 rollback. 이 검증은 로컬 SQLite 기준이며 다중 프로세스/다른 DB의 모든 동시성 보장으로 확대하지 않음.
- backend/transport/rest_handler.py: 일반 태스크 GET/POST/PATCH/DELETE를 인증/팀 검사 및 manual_tasks 서비스에 연결. DELETE의 expected_updated_at 쿼리 추가. 이전 클라이언트는 인증/버전 정보를 함께 전송해야 함. DEV 전용 결정 helper 본문은 그대로이며 공통 PATCH 진입부의 팀 검사는 관련 회귀 감사 대상.
- backend/pipeline/domain/agile/test/test_task_approval_api.py: 이전 미인증 4개 경로의 200을 재현한 기록을 유지, 현재 401 확인.
- test_task_approval.py: 기존 인증 fixture를 PATCH의 get_current_user_optional에도 연결. 첫 기준 실행 32개 중 1개 실패는 이 fixture 불일치였음. 정상 담당자 수락이 403으로 차단되는 별도 회귀를 실제로 재현한 뒤 정상 상태 전환만 복구. 초기 잘못된 테스트 User 필드명 오류는 공격 재현 근거로 계산하지 않음.
- 추가 검증: 타 팀/가짜 payload 거부, PM 생성, 버전 충돌, 거절 기록 보존, 필수 기준 제거 거부, 담당자 수락/사유 거절 및 필드 권한, 생성/수정 commit 실패 rollback. 삭제 기준 버전 누락 시 기존 API가 200으로 실제 삭제하는 실패 재현 후 409/409/정상200 확인.

## 변경 015 — 태스크 화면의 인증·검토 버전·실패 결과 연결 (2026-09-08)
- src/components/resultViewer/TaskApprovalPanel.jsx: 기존 태스크 조회/생성/수정/거절/재배정/삭제 및 컴포넌트 내 요청에 인증 헤더 전달. HTTP 실패와 detail을 검증하고 사용자에게 오류를 표시. 계정/팀 변경 후 도착한 응답이 현재 목록에 반영되지 않도록 대조하며 전환 시 목록/검토/선택 상태 초기화.
- startEdit에서 기준 updated_at을 편집 폼에 보관하여 자동 새로고침으로 최신 버전을 몰래 승인하지 않음. 수정/상태 변경/거절/재배정은 기준 버전 전송, 단건/선택 삭제도 URL 인코딩한 기준 버전 전송.
- 삭제 화면은 서버 정책과 일치: 완료된 일반 태스크만 PM에게 삭제 선택 제공. 거절/필수 보안/타 도메인 기록은 삭제 버튼 없음. 미할당 그룹의 기존 삭제 선택은 제거.
- 선택 삭제는 각 응답을 확인하고 성공 항목만 제거. 실패 항목은 남기고 성공/실패 개수 및 오류 표시. 여러 독립 DELETE의 결과를 정직하게 표시하는 방식이며 선택 삭제 전체의 원자성을 주장하지 않음. 승인 후보 일괄 저장의 원자성과는 별개.
- backend/pipeline/domain/agile/test/task_panel.test.mjs 신규: 설치된 rolldown으로 실제 JSX를 변환하고 실제 컴포넌트 이벤트를 실행. React 스케줄링/네트워크만 격리. 인증 헤더, 편집 버전 보존 및409오류/폼 유지, 부분 삭제 실패 보존, 이전 계정 지연 응답 차단, 삭제 금지 기록 UI 검증.
- 수정 전 인증 헤더 undefined, 이전 계정 목록 노출, 금지 기록 삭제 UI를 assertion으로 재현. 테스트 실행기 순회 오류는 수정 후 재실행했고 공격 재현으로 계산하지 않음. 완료 목록의 선택 삭제는 기존 UI에서 미제공 상태를 확인하고 연결. 수정 후 태스크 5개와 기존 메모 스토어 7개 모두 통과.
- 명령(저장소 루트): node --experimental-vm-modules --test backend/pipeline/domain/agile/test/task_panel.test.mjs backend/pipeline/domain/chat/test/memo_store.test.mjs
- 이 검증은 실제 브라우저 DOM/화면 클릭 통합을 대체하지 않으며 해당 검증은 미완료.

## 변경 016 — 태스크 조회/승인의 DB 설정 통일 및 현재 회귀 (2026-09-08)
- backend/pipeline/domain/agile/task_coordinator.py: 자체 고정 storage/local.db 엔진/세션 생성을 auth.database의 engine/SessionLocal 별칭으로 연결. 기존 private DB 별칭, AgileTask 모델, CRUD 함수 서명과 결과 유지. auth 모델/migration 파일 변경 없음.
- 이유: 환경변수로 저장 경로를 바꾸면 승인/수동 API는 설정 DB를 사용하지만 generator/distributor/coordinator 조회는 고정 DB를 보던 불일치. 공용으로 사용되는 파일이므로 DEV 호출자 영향도 확인 대상에 포함.
- backend/pipeline/domain/agile/test/test_task_storage.py 신규: 별도 Python 프로세스에 임시 NAVIGATOR_LOCAL_DATABASE_URL을 설정. 대상 검증 후에만 DDL/쓰기 실행하여 실사용 DB 접근 방지. 수정 전 coordinator ignores configured database assertion 실패. 수정 후 동일 엔진과 양방향 조회/쓰기를 실제 임시 SQLite로 확인.
- 최종 Agile 명령(backend): .venv/Scripts/python.exe -m unittest discover -s pipeline/domain/agile/test -p test_*.py — 36개 통과.
- Chat 회귀(backend): 동일 discover의 -s pipeline/domain/chat/test — 28개 통과. DB 설정 통일 후 실행. 그 후 변경은 태스크 DELETE의 버전 검사 및 전용 화면/테스트에 한정.
- 기존 DEV 공용 호출자 검사: .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider pipeline/domain/dev_tracking/test/unit/test_task_coordinator.py — 1개 통과. 테스트 파일 수정 없음. 실행에 필요하여 가상환경에 pytest9.1.1과 의존 패키지 설치, requirements/lockfile 변경 없음. 이 한 테스트를 DEV 전체 회귀로 표현하지 않음.
- 프런트: 태스크5 + 메모7 = 12개 통과. 최종 npm run build: 1723 modules, 10.69초 성공. 기존 Browserslist/큰 번들/혼합 import 경고 유지.
- git diff --check 통과. git diff --name-only 확인: 기존 11개 변경 파일과 이번 coordinator 1개. 신규 전용 테스트 및 manual_tasks 등은 git status로 별도 확인. REST 신규 두 줄의 CRLF로 발생한 diff whitespace 경고만 정리, 타 담당 소스/포맷 변경 없음.
- 공용 변경의 근거는 사용자의 P0~P5 승인·쓰기 연결 진행 지시이며 별도의 팀원 승인 사실을 새로 주장하지 않음. 최종 리뷰에 Runner/REST/프런트/coordinator 계약 변경을 함께 전달해야 함.
- commit/push/PR/merge/rebase 없음. 실사용 DB·API 키 변경 없음.
- 남은 P0~P5: 배분 요청 인증과 서버 팀원/태스크 ID 검증 및 제안 승인 연결, P3 후속 분석/지식 경로 감사, Runner/REST의 다른 호출자 회귀, 실제 브라우저에서 생성→승인→저장 통합, 최종 요구사항별 감사.
- P3 읽기 조사: DEV task_flow는 중복 태스크를 조회한 뒤 최소 approval_task 정보를 반환. persistence.develop_embedding은 GAP report를 별도 artifact로 저장하고 code chunk는 승인 전 제한. knowledge.query_dev_knowledge_artifacts에는 decision_status 기반 제외 조건이 보이지 않음. 일반 Agile 거절 태스크 본문이 이 경로에 실제 유입되는지는 추가 추적이 필요하며, 현재 정적 결과를 공격 성공 또는 RAG 전역 보호로 주장하지 않음. 해당 DEV 파일은 수정하지 않음.
- P6 Wiki/문서 실제 발행 변경은 계속 협의 대기. 소유권 없는 과거 데이터의 자동 이관도 수행하지 않음.


## 변경 017 — 팀 배분의 제안·승인 분리 (2026-09-08)
- 요청 근거: P0~P5의 기존 태스크 자동 변경/쓰기 우회 차단. security/agile-chat-write-gate / b9332f8 유지. P6과 DEV 소스 수정 없음.
- 수정 전 test_distribution_boundary.py 3개 실제 실패: 미인증 POST /api/agile/distribute-tasks가200, 정상 배분이 assign_task를 즉시 호출, 조회 목록 밖 foreign ID도 assign_task 호출. 모델/쓰기 함수 mock으로 실사용 DB 쓰기 없이 재현.
- backend/pipeline/domain/agile/nodes/task_distributor.py: assign_task 호출 제거. assigned=0과 assignment_proposals 반환. 실제 task ID/고유한 팀원 이름/역할·영역/중복/이유 필드 검증, 잘못된 결과는 전체 거부. task_type을 일반 Agile 유형으로 제한하고 rejected 및 DEV 승인 태스크를 배분 프롬프트에서 제외. JSON 임의4000자 절단 제거, 검토 배치 최대100개 제한. 모든 항목에 적합한 사람이 없으면 일부 후보 및 unproposed 개수를 반환하며 나머지를 자동 배분하지 않음.
- 팀원 조회는 User.team_id/global role 대신 실제 TeamMember N:M 소속과 팀 역할 사용. 팀원 이름은 기존 태스크 assignee 저장 형식과 연결되므로 동일 이름이 여러 명이면 임의 선택하지 않음.
- backend/pipeline/domain/agile/assignment_approval.py 신규: PM 권한 확인→서버 task/member snapshot→모델 후보→현재 상태 재확인→메모리 proposal 발급. 모델에 넘기는 데이터는 복사하여 원본 snapshot 보존. 클라이언트 members/distributed_by는 권한 근거로 사용하지 않음.
- 승인: 사용자/팀/PM 재확인, proposal 종류·만료·선택 검사, 현재 팀원 ID/이름/역할과 태스크 전체 snapshot 재대조. SQLite write lock 및 ID/팀/미할당/updated_at 조건부 UPDATE로 선택 배치 전체 적용. 저장 필드는 assignee/status=pending_approval/reviewed_by/updated_at. 본문/보안 메타데이터 유지. 부분 충돌과 commit 실패는 rollback. 성공 재요청은 같은 결과, 결과 불명 실패는 재실행 금지.
- backend/transport/rest_handler.py: 배분 생성 엔드포인트 인증 및 서버 서비스 연결, /api/assignment-proposals/{id}/approve/cancel 추가. 승인 본문은 selected_ids만 허용. 모델 호출의 JWT context는 인증 헤더에서 설정하고 finally 복원. 기존 body auth_token/members/distributed_by는 권한이나 팀원 목록으로 사용하지 않음. 이전 클라이언트에도 assigned=0이므로 자동 배분 성공을 주장하지 않음.
- src/components/resultViewer/TaskApprovalPanel.jsx: “배분안 생성” 동작, 별도 assignmentProposal 상태, 제안 본문 표시, 승인 성공 후만 태스크 재조회. 요청에서 클라이언트 팀원/배분자 제거. 계정 전환 시 후보 초기화.
- src/components/resultViewer/TaskProposalReview.jsx: task.assignment 종류에서 팀·태스크 내용·기존/새 담당자·역할·기준 버전·미할당→수락 대기를 표시. ID 선택 승인 또는 취소. 승인 응답 후 계정/팀/분석 변화 확인. 원격 오류 후 재제출 버튼을 비활성화하고 검토 닫기/새 제안 생성 안내 추가. 실패 후 버튼이 계속 활성화되어 있던 것을 UI 이벤트 테스트로 먼저 재현.
- 신규 테스트: test_distribution_boundary.py 3개, test_assignment_approval.py 10개, assignment_review.test.mjs 4개. 정상 선택·정확한 내용·idempotence·범위 밖/거절/DEV/중복 ID·팀역할과 멤버 탈퇴·PM상실·다른 사용자·만료·취소·선택 위조·배치 rollback·commit 실패·모델 호출 중 동시 변경·HTTP 내용 위조·인증을 검증.
- 최신 Agile 전체: .venv/Scripts/python.exe -m unittest discover -s pipeline/domain/agile/test -p test_*.py — 49개 통과. 프런트 태스크5/배분검토4/메모7 =16개 통과. 오류 후 닫기 추가 후 배분검토4개 재통과.
- npm run build: 1723 modules 성공(약1분3초). 마지막 “오류 후 검토 닫기” 추가 직전 빌드이며 그 후 변경은 JSX를 실제 변환·실행한4개 테스트로 검증. 최종 전체 감사에서 빌드 재실행 필요. 기존 Browserslist/큰 번들/혼합 import 경고 유지.
- git diff --check 통과. commit/push/PR 없음. 아직 Memo 화면 및 다른 공용 호출자 전체 회귀, P3 후속 입력 감사가 남아 있어 P0~P5 전체 완료로 처리하지 않음.

## 변경 018 — 실제 브라우저에서 태스크 승인·배분 확인 (2026-09-08)
- backend/pipeline/domain/agile/test/browser/ 신규: server.py, vite.config.mjs, serverClient.mjs, index.html, entry.jsx. 실제 TaskApprovalPanel/TaskProposalReview/보안 범위 화면과 REST API·JWT 인증 사용. 테스트 DB는 tempfile 안에 생성하고 프로세스용 JWT secret은 임의 생성. 테스트 모델만 고정 응답으로 대체하고 팀원 조회는 로컬 테스트 endpoint에 연결. 실제 API 키·계정·운영 DB·원격 Cloud Run을 사용하지 않음.
- 환경: backend127.0.0.1:8897, 프런트127.0.0.1:5197. 테스트 전용 페이지는 /backend/pipeline/domain/agile/test/browser/index.html. 일반 제품 실행 경로에 이 fixture를 연결하지 않음. 저장소의 주 vite.config/main.py 변경 없음.
- 브라우저로 배분안 생성: 기존 task-one/task-two 둘 다 DB status=unassigned/assignee빈값. 생성 버튼만으로 쓰기가 발생하지 않음 확인.
- 첫 후보만 선택 승인: 화면 “배분 완료:1개”, DB task-one만 pending_approval/Test Developer/reviewed_by=browser-pm으로 변경. task-two는 미할당 유지. task-one 본문 유지.
- 남은 task-two 배분안 생성 후 테스트 UI로 동시 내용 변경 주입. 승인 시409 메시지, 최신 description과 미할당 상태 보존. 실패한 같은 proposal 반복 적용도 서버가 거부. UI 재제출 비활성화와 “검토 닫기”로 복귀 확인.
- 신규 생성: 프로젝트 공통 JWT 선택 및 전체 적용 범위 확인 → 일반 신규 후보1개와 JWT 필수 보완 후보1개 표시. 일반 후보만 선택하면 승인·저장 버튼 비활성화. 둘 다 선택하면 활성화.
- 승인 후 화면 신규2개/수정0개, DB에 일반 기능과 JWT 검증 태스크가 정확한 본문으로 저장. 둘 다 unassigned, created_by/reviewed_by=browser-pm, analysis_id=browser-run. 보안 행에는 rule_id=jwt_validation/feature_ref=__project__ 및 서버 approval_id가 기록됨.
- 결과 확인은 실제 브라우저 UI 조작과 테스트 DB 조회 표시로 수행. 모델 공격률/원격 실제 계정 통합/전체 앱 로그인 완료 근거로 확대하지 않음.
- 테스트 서버는 다음 Memo 화면 통합을 위해 실행 중이며 종료 전 현재 프로세스를 재확인해 테스트 프로세스만 정리한다. 기존 사용자 앱 프로세스는 중지하지 않음.


## 변경 019 — 메모 승인 응답의 계정 경계 및 실패 후 재검토 (2026-09-08)
- P0~P5 승인 화면 연결의 후속 작업. 브랜치 security/agile-chat-write-gate 유지, 기준 main ae43fe9ae119629cbfc9cbaa1f55c15babede926. DEV/PM/SA 및 P6 변경 없음.
- src/components/resultViewer/MemoProposalReview.jsx: 승인 요청 중 토큰/사용자/팀/서버 프로젝트 변경 시 이전 응답의 성공 알림·목록 조회·제안 닫기를 차단. 목록 조회가 끝난 뒤에도 같은 컨텍스트인지 재확인. 서버 승인 자체를 취소했다고 주장하지 않음.
- 네트워크/서버 실패 후 needsReview 상태로 전환하여 승인 및 선택을 비활성화. 무조건 재승인하도록 안내하던 문구를 제거하고 검토 닫기→저장된 목록 조회→필요한 후보 재생성으로 안내. 닫기 동작은 새로운 승인 API 호출 없이 syncMemos를 호출. 기존 syncMemos는 조회 실패를 내부에서 기록하고 반환하므로 목록 갱신 성공 여부를 UI에 전달하는 보완은 남아 있음.
- backend/pipeline/domain/chat/test/memo_review.test.mjs 신규: 실제 JSX를 rolldown 변환 후 VM에서 실행. 정상 본문 미리보기/선택 ID만 전송/인증 헤더/저장 후 조회, 결과 불명 시 재승인 차단 및 닫기, 요청 전후 계정·토큰·팀·프로젝트 변경, 취소/만료 검증.
- 수정 전 4개 중 2개 실제 실패: 실패 후 승인 버튼 활성, 다른 계정으로 바뀐 뒤 성공 알림 1회. 최초 설치 스크립트는 시스템 Python의 write_text newline 인자 미지원으로 실패했으며 이를 공격 재현으로 계산하지 않음. 저장소 가상환경으로 설치 후 위 실제 실패를 확인.
- 수정 후 node --experimental-vm-modules --test backend/pipeline/domain/chat/test/memo_review.test.mjs backend/pipeline/domain/chat/test/memo_store.test.mjs backend/pipeline/domain/agile/test/assignment_review.test.mjs backend/pipeline/domain/agile/test/task_panel.test.mjs: 20개 통과.
- backend에서 .venv/Scripts/python.exe -m unittest discover -s pipeline/domain/chat/test -p test_*.py: 28개 통과. 정상/오류 주입 및 임시 DB 사용. 표시된 commit failed 로그는 의도된 오류 테스트.
- npm run build: 최신 메모 및 태스크 검토 닫기 변경 포함, 1723 modules/8.43초 성공. 기존 Browserslist/큰 번들/혼합 import 경고 유지. git diff --check 통과.
- 추가로 확인한 미완료: MemoManager의 sync 효과는 currentSessionId만 관찰하고 authToken/serverSessionId/사용자 변경을 관찰하지 않음. authSlice.clearAuth는 userComments를 비우지 않음. syncMemos 실패 시 기존 목록 보존, addComment의 늦은 성공 알림은 현재 프로젝트 확인 밖에 있음. 실제 상태·화면 전환 테스트로 범위를 확정하여 보완 필요. 단순 조회 효과 추가만으로 전역 분석 입력 격리가 완료됐다고 보지 않음.
- 전체 P0~P5 완료는 아님: MemoManager 실제 브라우저 통합, 위 상태 경계, 공용 호출자 회귀, 거절 태스크의 후속 입력 경로 감사가 남음. 최신 코드 및 기록은 미커밋 상태, commit/push/PR 없음.


## 변경 020 — 메모 상태의 계정·팀 전환과 조회 실패 처리 (2026-09-09)
- P0~P5 프런트 승인 연결 후속. security/agile-chat-write-gate 유지. DEV/PM/SA/P6 파일 변경 없음. 공용 프런트 authSlice의 메모 상태 초기화만 추가하며 로그인 API와 권한 정책은 변경하지 않음.
- src/store/slices/authSlice.js: setAuth에서 토큰·사용자·팀 변경, clearAuth에서 메모 목록/제안/조회 오류 초기화. 팀 workspace에 serverSessionId 보관·복원, 오래된 메모 목록은 복원하지 않고 서버 재조회 대상으로 둠.
- src/store/slices/sessionSlice.js: 새 프로젝트와 세션 로딩에서 메모 입력/제안 초기화. sameMemoContext로 토큰·사용자·팀·로컬 프로젝트·백엔드 비교. 수동 저장/삭제 지연 응답이 다른 컨텍스트의 상태·성공 알림을 갱신하지 않도록 반환 false. syncMemos는 성공 true/실패 false, 실패 시 현재 컨텍스트의 기존 메모 입력을 제거하고 memoSyncError 표시. 다른 컨텍스트에 도착한 조회 결과는 반영하지 않음.
- src/components/resultViewer/MemoManager.jsx: 계정·팀·서버 프로젝트·연결 변경을 목록 조회 효과에 반영. memoSyncError와 목록 다시 확인 버튼 표시.
- src/components/resultViewer/MemoProposalReview.jsx: 검토 닫기에서 조회 성공 여부 확인. 조회 실패 시 닫지 않으며 승인 API 재호출 없이 조회만 다시 시도. 승인 성공 후 목록 조회 실패는 저장 완료 표시를 유지하고 목록 오류로 안내. 결과 불명 상태의 제목을 아직 미저장이라고 단정하지 않도록 변경.
- memo_store.test.mjs: 실제 auth/session/pipeline slice 실행. 수정 전 추가4개 실패(인증변경 후 메모 잔존, sync 실패 결과 undefined, 새프로젝트 메모 잔존, 팀전환 후 지연저장 true). 수정 후 기존7+신규4=11 통과.
- memo_review.test.mjs: 실패 후 목록 조회도 실패하면 제안이 닫히는 것을 신규 테스트로 재현(5개 중1개 실패). 수정 후5개 통과. 실패 뒤 조회 재시도에서도 승인 요청은 최초1회 유지.
- 관련 프런트 전체 명령: node --experimental-vm-modules --test backend/pipeline/domain/chat/test/memo_review.test.mjs backend/pipeline/domain/chat/test/memo_store.test.mjs backend/pipeline/domain/agile/test/assignment_review.test.mjs backend/pipeline/domain/agile/test/task_panel.test.mjs. 25개 통과. git diff --check 통과.
- 중간 테스트 설치 실행이 사용량 한도에 따른 자동 승인 검토에서 거절됨. 실제 파일 미변경을 확인하고 다음날 같은 승인 경로로 재시도하여 실행 완료. 우회 실행 없음.
- 남은 감사: ensureServerSession과 분석 호출의 await 전후 팀/계정 일치, 실제 MemoManager 브라우저 통합, 공용 호출자 및 거절 태스크 후속 입력. 전체 P0~P5 완료로 판단하지 않음. commit/push/PR 없음.


## 변경 021 — P3 거절 태스크의 모델·실행·지식 경로 감사 (2026-09-09)
- 기준: security/agile-chat-write-gate 작업 트리, HEAD b9332f82af31f81d963ab7c5653bfd1a48496ade / main ae43fe9ae119629cbfc9cbaa1f55c15babede926. 이번 제품 코드 변경 없음. backend 전체 Python 호출자 검색과 실제 함수 본문을 대조.
- task_generator.run_task_generator: 전체 행의 title/ref는 서버 중복 방지에 사용. _build_user_msg는 status=rejected 행을 제외하고 update 대상도 unassigned로 제한. test_rejected_content_never_reaches_model_but_blocks_recreation이 title/description/ref/assignee 미전달과 중복 재생성 차단을 확인.
- task_distributor.run_task_distributor: unassigned이면서 일반 TYPES에 속한 행만 모델에 전달. _get_current_workload는 pending_approval/in_progress/pr_pending의 개수만 사용. test_distribution_boundary.py에 거절 title/description/payload marker 미전달·작업량0·허용 후보 유지 검증1개 추가. 기존 구현 확인 테스트이며 신규 취약점 수정/수정 전 실패로 주장하지 않음.
- task_approval: 생성 후 거절된 중복 행이 추가돼도 저장 직전에 다시 검사. 기존 test_rejected_duplicate_is_not_recreated_after_generation, test_rejected_security_task_is_not_recreated가 일반/보안 거절 항목 재생성 차단 확인. 단순 문자열 의미 유사성 전체를 보장하지 않고 정규화 title/ref/보안 rule identity 기준.
- 일반 태스크 PATCH는 mutate_manual_task로 반환. 직접 실행 함수 execute_approved_task의 현재 외부 호출자는 rest_handler._run_dev_gap_decision이며 task_type=dev_gap_approval 확인 후에만 호출. 일반 거절 태스크를 이 경로에서 실행 또는 RAG 쓰기로 넘기는 연결은 현재 코드에서 발견되지 않음.
- DEV task_flow의 list_tasks는 dev_gap_approval/PR 중복 조회에 사용되며 다음 단계에는 task_id/type/status만 반환. 일반 Agile 태스크 본문은 이 조회에서 Dev 지식으로 전달되지 않음.
- 별도 DEV 지식 경로: develop_embedding은 GAP state로 DEV_GAP_REPORT artifact 저장, 승인 상태에 따라 코드 청크 정책을 구분. knowledge.query_dev_knowledge_artifacts는 team/repo/branch/type/query 필터는 있으나 decision_status 제외 필터 없음. 이는 DEV GAP 판단/지식 정책이며 일반 Agile 거절 태스크의 재유입 근거와 구분. DEV 담당자에게 REJECTED_UNINTENTIONAL_CHANGE의 검색 허용 의미와 기존 artifact 취소/갱신 정책 리뷰가 필요. 해당 소스는 변경하지 않음.
- backend에서 .venv/Scripts/python.exe -m unittest discover -s pipeline/domain/agile/test -p test_*.py: 50개 통과(기존49+배분 거절 경계1). 실제 모델 공격률 및 모든 외부 RAG 오염 차단을 증명하지 않음. 상위 설계에 복사된 비신뢰 텍스트의 원본 판별은 별도 입력 경계 문제.
- P3의 일반 Agile 저장 행→현재 생성/배분 호출 경계는 테스트·정적 호출자 확인 완료. DEV 지식 정책을 임의 변경하지 않으며 P6 발행 연계도 보류. 남은 P0~P5: 메모 실제 브라우저 통합, 비동기 프로젝트/팀 경계, Runner/API 호출자 회귀 및 최종 요구사항 전체 감사. commit/push/PR 없음.
- 변경020 최신 프런트 빌드 추가 기록: 1723 modules,41.78초 성공. 기존 Browserslist/번들/혼합 import 및 plugin timing 경고 유지.


## 변경 022 — 프로젝트 지연 응답 경계와 실제 메모 화면 통합 (2026-09-09)
- sessionSlice.ensureServerSession: 프로젝트 등록/조회의 동시 요청 키에 사용자·팀·백엔드·기존 서버 프로젝트를 포함. 응답 시 sameMemoContext와 기존 serverSessionId를 대조하여 팀/서버 프로젝트 변경 후 이전 ID를 연결하지 않음. 서버에서 이미 생성된 프로젝트를 자동 삭제하지 않음.
- memo_store.test.mjs 신규 테스트는 수정 전 팀 전환 후 프로젝트 응답이 성공 반환되는 실제 실패를 재현. 수정 후 팀 변경/서버 프로젝트 변경 모두 거부, 전체12개 통과.
- browser/server.py, entry.jsx: 기존 격리 fixture에 MemoItem 임시 테이블, 실제 issue_memo_proposal을 호출하는 테스트 준비 endpoint, DB 메모 표시, 실제 MemoManager 추가. 고정 후보2개를 준비하므로 실제 LLM 호출부터의 end-to-end 검증으로 주장하지 않음. 사용자 데이터/비밀값 사용 없음.
- 초기 Get-NetTCPConnection 조회가 권한 부족 환경에서 결과를 주지 않아 서버 부재로 오판. 새 서버는 포트 충돌로 종료되고 임시 DB cleanup 실행. netstat와 상승 권한의 읽기 전용 전체 명령줄 조회로 기존 fixture PID16436/Vite15540 확인. 살아 있는 exec 세션34439를 확인 후 Ctrl+C로 종료. 테스트 백엔드만 갱신해 PID14732/exec25852, 127.0.0.1:8897에서 실행. 기존 Vite5197은 그대로 사용. 일반 앱 프로세스 중지 없음.
- 실제 CUA 브라우저 탭2: 후보 준비 후 DB memos=[] 및 저장 버튼 비활성 확인. 첫 후보만 선택 승인 후 활성 메모1, DB ID ff10c66d-e5bb-4190-b091-93a414d3ad64/text=선택한 메모만 저장/detail=이 본문을 변경 없이 저장합니다./session_id=browser-project 확인. 두 번째 미선택 후보 저장 없음, 기존 태스크2개 그대로.
- 동일 후보를 다시 준비하고 첫 후보 승인: 서버 동일 메모 거부, 화면 결과 확인 필요/승인 버튼 비활성/검토 닫기 확인. 닫기 이후 실제 DB 조회에서도 기존1개 그대로. 원격 계정 통합·실제 모델 공격률의 증거로 확대하지 않음.
- 테스트 백엔드25852와 Vite18750은 추후 최종 화면 검증을 위해 유지, 종료 전 실제 핸들 확인 필요. 브라우저 탭2 handoff 표시. 전체 완료 시 검증 프로세스 정리 필요.
- 이번 기준 브랜치 security/agile-chat-write-gate, P6 및 DEV/PM/SA 소스 변경 없음. commit/push/PR 없음. 남은 P0~P5: Runner/API 전체 호출자 계약 및 최종 요구사항 감사, 필요한 공용 회귀. P3 일반 태스크 경계와 메모 기본 승인 UI 확인 완료.


## 변경 023 — REST 채팅의 메모 승인 계약 연결 (2026-09-09)
- Runner 호출자 감사: run_analysis/run_idea_chat는 ws_handler의 해당 메시지 분기에서 호출. _run_pipeline_base의 save=True는 SA 분석 결과 저장에 사용하고 persistence_context 필수. PM 단계/Idea Chat은 save=False. REST /api/analyze는 execute_pipeline의 shape 결과 반환 경로로, 현재 그 endpoint 자체에서 분석/메모 DB 저장하지 않음. REST 분석 결과를 소유권 없는 과거 실행 데이터처럼 자동 연결하지 않음.
- 실제 누락 발견: REST /api/idea-chat는 모델 notes_to_add를 그대로 반환하고 승인 제안을 발급하지 않았음. 미인증 요청에서도 같은 legacy 필드가 반환되는 실제 HTTP 테스트2개 실패 확인. 서버 자동 DB 저장 취약점으로 과장하지 않으며, WS와 다른 후보/저장 계약을 수정한 것.
- backend/transport/rest_handler.py: IdeaChatRequest에 선택 session_id 추가(기존 호출은 빈값). optional bearer 사용자 및 DB 의존성 연결. 기존 대화 응답은 유지하고 notes_to_add=[]로 고정. 후보가 있으면 실제 issue_memo_proposal로 사용자·프로젝트 소유권 검사 후 발급. 후보 검증/권한 실패는 memo_proposal=None과 오류 안내, DB 쓰기 없음. 클라이언트가 제공한 사용자 ID를 신뢰하지 않음.
- backend/pipeline/domain/chat/test/test_memo_rest_boundary.py 신규: 실제 REST endpoint/execute_pipeline/result shaping과 임시 DB 사용, 모델 pipeline.invoke만 고정. 인증된 개인 프로젝트의 정확한 제안 내용/미저장, 익명·외부 프로젝트 거부/대화 유지 확인. 기존 MemoApprovalTests의 격리 setUp/cleanup을 재사용.
- Chat unittest 전체30개 통과(기존28+REST2). 명령: backend에서 .venv/Scripts/python.exe -m unittest discover -s pipeline/domain/chat/test -p test_*.py. 수정 전2개 실패는 notes_to_add에 후보 원문이 남는 assertion 실패.
- PM/SA 기존 unit 일부는 실제 Gemini 호출을 요구하는 테스트임을 확인. 단위라는 파일명만으로 실행하지 않음. 공용 회귀의 실제 모델 검증과 mock 검증을 구분해야 함. 이번 변경은 PM/SA/DEV 소스 및 테스트를 수정하지 않음. P6 보류 유지, commit/push/PR 없음.
- 남은 최종 감사: 요구사항별 증거 표와 공용 인터페이스 인수인계, 최신 전체 관련 회귀/빌드/범위 확인, 검증 프로세스 종료. REST analyze의 별도 인증·RAG 정책과 DEV 지식 정책은 이 변경으로 보호됐다고 주장하지 않음.


## 변경 024 — 최종 회귀와 P0~P5 증거 정리 (2026-09-09)
- AGILE_SEC_COMPLETION_AUDIT.md 신규. 계획의 P0~P5 요구사항을 구현/테스트/브라우저 증거와 연결하고 공용 인터페이스·운영 제한·P6 보류를 기록.
- 최신 실행: Agile50/Chat30/기존 DEV coordinator1/프런트26 통과. 빌드1723 modules/35.78초 성공. 실제 모델을 호출하는 PM/SA 테스트는 실행하지 않았으며 Runner의 PM→SA 계약 mock 검증과 구분.
- 테스트 프로세스25852와18750의 live 핸들을 확인하고 Ctrl+C 종료. netstat로8897/5197 미점유 확인. 사용자 앱 중지 없음.
- DEV/PM/SA 및 AGENTS.md의 git diff --numstat 결과 없음. HEAD b9332f82af31f81d963ab7c5653bfd1a48496ade/main ae43fe9ae119629cbfc9cbaa1f55c15babede926 유지. commit/push/PR 없음.


## 변경 025 — 사용자 수동 검증 준비 (2026-09-09)
- 사용자 요청에 따라 일반 Electron 앱 실행. 기존5173 개발 서버 중복으로 새 Vite는 종료했지만 Electron 앱은 기동, backend50661 /health200 및 WS 연결 확인. 사용자 검증을 위해 앱 유지.
- 격리 검증 backend8897(exec3127/PID24688), Vite5197(exec71119) 실행. 실제 데이터와 분리한 후보/승인 UI를 사용자에게 제공. 이번에는 시나리오를 대신 실행해 DB를 소모하지 않음.
- AGILE_SEC_MANUAL_TESTS.md 신규: 순서형10개 기본 케이스, 만료/오프라인/수동작성/계정권한/실모델5개 추가 케이스, 기대 DB값/실패 기준/재시작/자동 테스트/기록표 포함. 제품 코드 수정 없음, commit/push 없음.

## 변경 026 — Cloud Run 서버 주소 갱신 (2026-09-10)
- 사용자 명시 요청에 따라 새로 배포하고 `/health`, `/auth/status`에서 HTTP 200을 확인한 Cloud Run 서비스 `navigator-server-681502864272.asia-northeast3.run.app`으로 연결 주소를 갱신.
- `src/api/serverClient.js`: 로그인·팀·서버 API가 새 Cloud Run 서비스로 요청되도록 `SERVER_URL` 기본값 한 줄 변경.
- `backend/pipeline/core/utils.py`: Gemini 키 조회의 `_CLOUD_RUN_SERVER` 기본값 한 줄 변경. 기존 `NAVIGATOR_SERVER_URL` 환경변수 우선 동작은 유지.
- 두 연결 파일은 AGILE-SEC 단독 범위 밖 또는 공용 연결부이며, 사용자가 이번 대화에서 주소 변경을 명시적으로 승인하여 최소 변경만 수행. 기존 API·요청 형식·인증 로직 변경 없음.
- 기존 작업 트리 변경은 보존. commit/push/PR 없음.

## 변경 027 — 인증·대화 격리 목표 기준선과 실패 재현 (2026-09-11)
- 브랜치 security/agile-chat-write-gate, HEAD b9332f82af31f81d963ab7c5653bfd1a48496ade, main/merge-base ae43fe9ae119629cbfc9cbaa1f55c15babede926 확인. 기존16개 추적 변경 및 미추적 작업 보존.
- AGILE_SEC_AUTH_REPAIR_PLAN.md 신규: W0~W6 의존관계, 코드 근거/재현/미확인 구분, 공용 파일별 최소 변경·승인표, 수동 시나리오, SQLite 제한 기록. 이전 P0~P5 승인과 새 인증 리팩터링 승인은 구분.
- backend/pipeline/domain/chat/test/test_session_access_boundary.py 신규: 임시 SQLite와 실제 REST 라우터로 owner 복원, 익명/다른 사용자 복원 거부, 익명 삭제 거부 수용 테스트4개. 원격 계정/키/운영 DB/모델 호출 없음. 인증 사용자만 주입하며 원격 인증 검증으로 주장하지 않음.
- 새4개 중 owner1개 통과,3개 실패. 익명 및 다른 사용자가 개인 결과200으로 받음. 삭제 endpoint는 실제 삭제 없이200 성공만 반환함 확인. 기존 분석의 실제 무단 삭제 가능성 주장을 정정.
- Agile 전체50개 통과, Chat 전체34개 중31개 통과/새3개 실패(기존30개 통과). 실패는 제품 결함을 재현하므로 skip하지 않음. 실제 앱 로그인/계정 전환/+ 메뉴/실제 GitHub는 미검증.
- 공용 제품 코드 수정·DB 이전·Cloud 설정 변경·배포·commit·push·PR 없음. 기존 승인 범위를 이번 공용 인증/프런트 변경으로 확대하지 않음.
- 남은 항목과 정확한 승인 요청 파일은 신규 계획4절. 전체 목표 미완료. 이번 변경은 신규 테스트/계획 및 이 append로 한정하며 reset/clean으로 기존 작업을 되돌리지 않음.

## 변경 028 — 로그아웃·동일 팀 계정 전환 재현 및 GitHub 계획 정정 (2026-09-11)
- backend/pipeline/domain/chat/test/memo_store.test.mjs에3개 append. 로그아웃·같은 팀 계정 변경 시 private chatHistory 제거 수용 테스트2개 실패. 동일 컨텍스트의 동시 프로젝트 생성 요청1회 보장 테스트1개 통과. 기존12개 통과 유지. root에서 node --experimental-vm-modules --test backend/pipeline/domain/chat/test/memo_store.test.mjs 결과15개/13통과/2실패.
- 실제 제품 store 모듈을 VM에서 실행하고 서비스/localStorage만 격리 대체. 사용자 데이터·원격 서비스 미사용. 공용 제품 파일 수정 없음.
- AGILE_SEC_AUTH_REPAIR_PLAN.md 7절에 재현·중복 요청 조사 범위와 GitHub 정정 기록. server/routers/auth.py의 _oauth_sessions가 선언만 있음을 확인하여 Device Flow용 영속 상태 저장 도입 주장을 철회. poll의 invalid Authorization fallback, 기존 계정 GitHub 연결 자동 해제, GitHub 사용자 조회 실패 검증을 승인 후 수정 목록에 포함.
- 담당 밖 승인 없음은 유지. 이번 신규 코드는 Chat 전용 테스트3개뿐이며 계획/변경 기록에만 append. 실제 앱/GitHub 성공 검증·Cloud 변경·commit/push/PR 없음. 전체 목표 미완료.
