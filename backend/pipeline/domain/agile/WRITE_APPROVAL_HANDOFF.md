# AGILE-SEC 쓰기 승인 연결안 — 팀원 검토 대기

## 현재 상태
- 기준 main: ae43fe9ae119629cbfc9cbaa1f55c15babede926
- 작업 브랜치: security/agile-chat-write-gate
- 기존 태스크 후보 분리 커밋: b9332f8
- 신규 메모·문서 후보 모듈은 독립 구현이며 실행 경로에 연결하지 않았다.
- 기존 메모 자동 저장·문서 발행은 여전히 동작한다. 승인 게이트 구현 완료로 보지 않는다.
- 공용 API, Runner, 저장 함수, Connector, 프런트 및 Dev Tracking 코드는 수정하지 않았다.

## 준비된 로직
- chat/memo_candidates.py: dict 목록 전체 검증, 기존 길이 한도(200/60/4000) 초과 시 거부, 정확히 같은 메모 중복 제거, 프로젝트와 본문을 포함한 변경 감지 지문.
- agile/publish_candidates.py: 최종 Markdown·저장소·페이지·발행 모드·기준 버전을 포함한 변경 감지 지문. 문서를 재생성하거나 외부 요청을 보내지 않는다.
- 두 모듈은 immutable 후보만 반환한다. 키·토큰·승인 필드를 받거나 생성하지 않는다.
- 지문은 공개적으로 재계산 가능한 SHA-256이며 인증·승인 증명이 아니다. 요청이 제출한 지문과 요청 본문끼리 비교하는 것만으로 저장을 허용해서는 안 된다.
- 이 후보 스키마는 제안이며 공용 DTO를 교체하거나 외부 호출 계약을 변경하지 않았다.

## 연결 전에 합의할 서버 계약
1. 인증된 사용자와 프로젝트/팀 소유권을 서버에서 확인한다. 클라이언트·LLM의 actor/team/approved 값은 신뢰하지 않는다.
2. 검토 화면에 보낸 정확한 내용과 대상을 서버에서 보관하거나 위변조 방지된 방식으로 연결한다. 미승인 초안 보관 정책은 별도 합의한다.
3. 사용자 승인 요청에서 선택한 후보만 조회한다. 요청 본문으로 원본 후보를 임의 교체하지 못하게 한다.
4. 만료·취소·재사용 여부를 검사한다. 저장 성공/실패/실행 중을 구분하고 중복 승인을 원자적으로 제어한다.
5. 승인 후 내용·대상·기준 버전이 바뀌면 다시 검토한다. 최종 Markdown을 승인 후 LLM으로 재생성하지 않는다.
6. 외부 쓰기 직전 대상 존재·권한·버전을 재확인한다. 빈 expected_revision은 신규 대상이라는 증명이 아니다.
7. commit/외부 응답 성공 후에만 성공과 실제 ID를 반환한다. 타임아웃은 실패 확정이 아니라 결과 불명일 수 있으므로 재조회 후 재시도를 결정한다.
8. 로컬 개인 사용과 팀 사용의 권한 기준은 분리해 정의하되 인증 서버 장애를 이유로 검증을 우회하지 않는다.

## 담당자 검토가 필요한 파일과 최소 변경
개별 담당자 이름은 미확정이다. Spec의 실제 담당자 확인 후 리뷰를 요청한다.

| 파일 | 최소 변경 | 영향 |
| --- | --- | --- |
| backend/orchestration/pipeline_runner.py | notes_to_add 즉시 commit 대신 검토 후보 전달, 저장 실패 응답 정합성 | 채팅 응답 계약 |
| backend/transport/rest_handler.py | 메모/발행 승인 검증, 세션·팀·대상 권한 확인 | 공용 API 및 DTO |
| src/store/slices/pipelineSlice.js 및 메모 화면 | 후보 선택·저장 확인, 저장된 항목과 미저장 항목 구분 | 채팅·메모 UI |
| src/store/slices/sessionSlice.js | 실패한 임시 메모의 상태 구분 | 수동 저장 흐름 |
| src/components/github/GitHubDashboard.jsx | 정확한 최종 본문·저장소·모드 미리보기 및 승인 | 발행 UI |
| backend/pipeline/domain/agile/wiki_publisher.py | 준비와 실행 분리, 승인된 최종 Markdown 사용 | doc_sync 등 호출자 리뷰 필요 |
| backend/pipeline/domain/agile/nodes/doc_sync.py | 직접 동기화 경로도 같은 승인 계약 사용 | Dev Tracking 공개 인터페이스 |
| backend/connectors/github_connector.py | 조회 오류 시 쓰기 중단, 충돌/중복 발행 처리 | 공용 GitHub 기능 |
| backend/pipeline/domain/dev_tracking/doc_updater.py | 기존 PM 승인과 문서 발행 승인 범위·재시도 합의 | DEV-SEC 소유, 수정 금지 |

PublishedSnapshot 공유 기능을 이번 문서 쓰기 범위에 포함할지는 미확정이다.
GitHub Wiki API 지원 여부는 공식 문서 및 실제 격리 연동으로 별도 검증해야 한다.

## 검증 현황과 남은 테스트
실행 위치: 저장소 backend. 실제 DB·LLM·GitHub 호출 없이 실행한다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s pipeline/domain/chat/test -p test_memo_candidates.py -v
.\.venv\Scripts\python.exe -m unittest discover -s pipeline/domain/agile/test -p 'test_*.py' -v
```

메모 6개, 문서 6개, 기존 태스크 7개: 총 19개 통과.
신규 모듈 구현 전에는 모듈 미존재로 수집 실패를 확인했다. 이는 기존 런타임 공격 성공을 재현한 회귀 증거가 아니다.

연결 후 필요한 테스트:
- 승인 없음/위조/다른 사용자·팀/만료/대상 변경 → DB 및 외부 쓰기 0회.
- 정상 사용자 승인 → 선택된 정확한 내용만 저장.
- 동시 승인·재전송 → 중복 적용 없음.
- commit 실패 → 저장 완료 응답 없음, 실제 ID는 성공 후 반환.
- 외부 조회 401/403/5xx → 생성 요청으로 전환하지 않음.
- 발행 중 타임아웃 → 결과 조회 없이 중복 쓰기하지 않음.
- Dev Tracking 승인·거절·재시도 회귀 검증.

팀원 승인 전 위 연결 파일은 수정하지 않는다.
