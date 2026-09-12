# 격리된 브라우저 검증

실제 UI/API/JWT 인증과 임시 SQLite를 사용합니다. 모델은 고정 응답이며 원격 인증 서비스와 실사용 DB에는 연결하지 않습니다.

backend 터미널:
```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
.\.venv\Scripts\python.exe pipeline/domain/agile/test/browser/server.py
```

저장소 루트의 다른 터미널:
```powershell
node node_modules/vite/bin/vite.js --config backend/pipeline/domain/agile/test/browser/vite.config.mjs
```

브라우저: http://127.0.0.1:5197/backend/pipeline/domain/agile/test/browser/index.html

배분안 생성 후 DB가 그대로인지 확인하고, 후보 하나를 선택 승인한 뒤 그 항목만 바뀌는지 확인합니다. 남은 항목의 배분안을 생성한 후 “동시 수정 재현”을 누르면 기준 버전 충돌을 검사할 수 있습니다. JWT 보안 적용을 확인한 후 신규 생성에서 필수 보안 후보 제외/포함 승인도 검사합니다.

기동할 때마다 새 임시 DB를 만듭니다. 일반 제품 실행용이 아닙니다. 검증 후 두 터미널에서 Ctrl+C로 종료합니다.


Memo verification: the fixture also mounts the real MemoManager. Use 메모 후보 준비 to issue two fixed candidates through the real memo proposal service. Test DB 확인 includes persisted memo rows. Select just one candidate and approve; only that candidate should appear. Reissuing and approving the same candidate should reject the duplicate and allow closing review after refreshing the list. This fixture does not call the real chat model.
