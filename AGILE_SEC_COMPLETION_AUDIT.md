# AGILE-SEC P0~P5 검증 및 인수인계

2026-09-09. 전성빈 담당. 기준 main `ae43fe9ae119629cbfc9cbaa1f55c15babede926`, 작업 브랜치 `security/agile-chat-write-gate`, HEAD `b9332f82af31f81d963ab7c5653bfd1a48496ade`.
작업 위치: `C:/Users/jsb46/Generative_AI/NAVIGATOR_ver1`. 아래 파일 경로는 이 루트 기준이다. 상세 재현·수정 기록은 AGILE_SEC_CHANGELOG.md 변경006~023 참조.

## 요구사항별 증거

| 항목 | 구현 및 검증 증거 | 판정 범위 |
|---|---|---|
| P0 기준선·격리 | 브랜치/main/HEAD와 diff 확인. 전용 테스트의 tempfile SQLite와 가짜 사용자, 모델 mock. browser/server.py도 import 전 임시 DB 환경 설정 | 로컬 검증 환경 확인 |
| P1 신규 후보, 기존 수정 | task_generator.run_task_generator는 created/updated=0, task_proposals/update_proposals 반환. test_task_proposals.py에서 승인 위조·ID·상태·길이·enum·RTM ref·파싱 오류·정상 diff 확인 | 모델 제안만으로 쓰기 없음 |
| P1 중복과 모델 문구 | 정규화 제목/ref로 기존·배치 중복 검사, 모델 summary를 저장 성공 근거로 사용하지 않음 | 의미가 같지만 제목/ref가 다른 모든 문장을 탐지하는 보장은 없음 |
| P2 필수 보안 태스크 | security_rules.py의 11개 규칙, PM이 확인한 RTM별/프로젝트 공통 적용 범위, 고정 기준 본문과 security identity 검사 | 태스크 존재/검토 기준 충족 검사이며 구현 보안성 인증은 아님 |
| P2 보완 후보·최종 저장 | task_approval.py에서 누락 후보 보완 및 선택 배치 재검사. test_task_approval.py의 전체 조건·미적용·제목 위장·규칙 제거·거절 규칙 테스트 | 미선택 필수 후보가 있으면 저장 차단. 브라우저 JWT 후보 선택 검증(변경018) |
| P3 거절 격리 | 생성기에서 거절 title/body/ref/assignee 제외, 배분기에서 거절 본문/payload와 workload 제외. 저장 직전 중복 재검사 | 일반 Agile 경로 검증. 변경021에 전체 호출자 조사 기록 |
| P3 DEV/RAG 경계 | DEV task_flow는 dev_gap_approval/PR 중복 조회 후 최소 ID/type/status만 전달. 일반 Agile 본문을 DEV 지식에 넣는 연결은 현재 호출자에서 발견되지 않음 | DEV GAP artifact 검색 정책은 별도 담당자 검토, RAG 전역 보호 완료 주장 안 함 |
| P4 메모 후보 | memo_candidates.py 정확한 내용/길이 검증, idea_chat.py 자유형식 fallback에서 후보 없음 | test_memo_candidates.py/test_idea_chat_candidates.py 정상·악성·형식 오류 검증 |
| P4 반환 경로 | WS Runner와 REST idea-chat 모두 notes_to_add=[] 및 별도 memo_proposal 반환 | test_memo_runner.py/test_memo_rest_boundary.py 실제 Runner/REST 계약 검증 |
| P5 승인 저장소 | approval_store.py UUID, 사용자/대상/kind, 유효기간, 선택 ID, 중복 실행 상태, 메모리 복사 | 단일 프로세스 메모리. 미승인 후보 DB 쓰기 없음 |
| P5 권한·정확한 내용 | task_approval/memo_approval/assignment_approval에서 서버 후보만 저장, 재인증·팀원·PM·소유권·현재 버전 재검사 | HTTP 후보 본문 덮어쓰기/위조 ID/다른 사용자 거부 테스트 |
| P5 충돌·실패·재전송 | SQLite 트랜잭션 및 조건부 UPDATE, 배치 rollback, 성공 동일 선택 재응답, 결과 불명 재실행 차단 | task/memo/assignment tests의 동시 변경·commit 실패·중복·취소·만료 사례 |
| P5 수동 작업·배분 | manual_tasks.py 팀 권한/필드/상태/검토 버전 검증, 배분은 후보 생성 후 선택 승인 | 기존 태스크 본문 자동 변경 없음. 담당자 수락/거절 정상 흐름 테스트 |
| P5 프로젝트 소유권 | project_sessions.py와 Runner 신뢰 컨텍스트, 서버 UUID 프로젝트와 실행 ID 분리, ownerless 데이터 거부 | test_project_sessions.py PM→SA Runner 저장 및 실패 검증. 모델 위조 ID를 저장 키로 사용하지 않음 |
| P5 화면·상태 | TaskProposalReview/MemoProposalReview, 승인 후 실제 행 재조회, 계정/팀/프로젝트 지연 응답 차단, 실패 알림/닫기, 캐시 메모 재검증 | 프런트26개 테스트. 브라우저 태스크 생성·부분 배분·충돌 및 메모 부분 승인·중복 차단 확인(변경018/022) |

## 실행한 검증

backend 디렉터리에서:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s pipeline/domain/agile/test -p test_*.py
.\.venv\Scripts\python.exe -m unittest discover -s pipeline/domain/chat/test -p test_*.py
.\.venv\Scripts\python.exe -m pytest pipeline/domain/dev_tracking/test/unit/test_task_coordinator.py -q -p no:cacheprovider
```

Agile 50개, Chat 30개, 기존 DEV coordinator 1개 통과. PM/SA 모델 노드 전체를 실제 Gemini로 실행했다는 의미는 아니다. PM→SA Runner의 소유권/저장 계약은 OwnedAnalysisFlowTests에서 모델 호출만 대체해 검증했다. 기존 PM/SA unit 중 실제 키를 요구하는 테스트는 실행하지 않았다.

루트에서:

```powershell
node --experimental-vm-modules --test backend/pipeline/domain/chat/test/memo_review.test.mjs backend/pipeline/domain/chat/test/memo_store.test.mjs backend/pipeline/domain/agile/test/assignment_review.test.mjs backend/pipeline/domain/agile/test/task_panel.test.mjs
npm run build
git diff --name-only
git diff --check
```

프런트26개 통과. 최신 빌드1723 modules/35.78초 성공. 기존 Browserslist 데이터, 큰 번들, 혼합 import, plugin timing 경고 유지. diff --check 통과.
브라우저 검증은 실제 화면·REST·JWT·임시 DB를 사용하되 모델 응답은 고정했다. 테스트 서버25852/18750을 현재 살아 있는 핸들로 확인 후 종료했고, 8897/5197 포트가 더는 listen하지 않음을 확인했다. 일반 앱 프로세스는 중지하지 않았다.

## 공용 인터페이스 인수인계

- pipeline_runner.py: 분석 요청은 auth_token/project_session_id 필요. 요청이 확인한 사용자·프로젝트·서버 run ID로 저장. PM 단계와 Chat은 DB 결과 저장하지 않음. Chat 후보는 별도 승인 서비스로 발급.
- rest_handler.py: 일반 tasks/memos API 인증·팀/프로젝트 검증. 태스크 수정/삭제에 expected_updated_at 필요. 생성 요청은 security_scope/scope_reviewed 필요. task/memo/assignment-proposals approve는 selected_ids만 수신. REST idea-chat의 선택 session_id 및 optional bearer로 후보 발급, 기존 대화 응답은 유지.
- task_coordinator.py: 기존 public CRUD 계약을 유지하며 DB engine/SessionLocal을 auth.database와 일치. DEV coordinator 기존 테스트 통과. DEV 전용 승인/후속 처리 로직은 변경하지 않음.
- 프런트 sessionService/sessionSlice/pipelineSlice/authSlice와 승인 화면: bearer 전송, 서버 프로젝트 연결, 미저장 제안을 userComments에 넣지 않음, 실제 저장 행만 후속 분석에 사용. 계정/팀 전환 시 메모 상태 초기화.
- 사용자 P0~P5 진행 지시를 근거로 필요한 공용 연결을 수행했다. 별도의 팀원 승인 사실을 주장하지 않는다. 병합 전 위 계약을 영향받는 담당자에게 전달해야 한다. 자동 메시지 전송/PR 생성/병합은 수행하지 않았다.

## 제한과 별도 후속 항목

1. 사용자와 합의한 P6 Wiki·문서 발행 게이트는 미구현 상태로 보류. 기존 publish_candidates 준비 코드는 발행 경로 보호 완료가 아니다.
2. 사용자가 보류한 원격 인증/팀 생성/GitHub Failed to fetch 복구는 수행하지 않음. 운영 계정에서의 전체 앱 흐름은 원격 인증 복구 후 별도 확인해야 한다.
3. 미승인 초안과 성공 receipt는 프로세스 메모리이며 재시작 시 무효. 다중 worker/분산 저장 보장은 없음. 실패·만료·재시작 후에는 목록을 다시 확인하고 새 제안을 검토한다.
4. 실시간 모델 공격 성공률, PM/SA 입력 사실성, DEV GAP 지식의 승인/거절별 검색 정책, 기존 RAG 재색인은 완료 대상에 포함해 주장하지 않는다. DEV 인수인계 근거는 변경021에 기록.
5. 의미상 중복, 사람이 잘못 확인한 보안 적용 범위, HTTP 요청이 실제 사용자 클릭인지의 암호학적 증명은 보장하지 않는다. 현재 검증 대상은 서버 권한과 정확한 선택 내용 및 저장 경계다.
6. 코드와 신규 테스트/문서는 미커밋 상태다. main/DEV/PM/SA 소스와 AGENTS.md diff 없음. .env/실사용 DB를 변경하거나 비밀값을 기록하지 않았다.

## 검토 결과

P0~P5의 로컬 구현과 해당 저장 경계 검증 증거를 위와 같이 확보했다. 전체 서비스 운영 검증이나 P6 완료와 구분한다. 공용 계약의 팀원 리뷰, 원격 인증 복구, 실제 모델 평가 및 P6은 별도 후속 작업이다.
