"""
PM Agent Pipeline — 아이디어 채팅 노드 v8.1
사용자와 대화하며 아이디어를 발전시키는 LangGraph 노드.
사용자가 "추가/메모/노트로 남겨줘" 등을 명시적으로 요청하면 notes_to_add에 항목을 채워
사용자가 메모 관리 화면에서 검토한 뒤 저장하도록 한다.

v8.1 변경:
- llm.with_structured_output(IdeaChatOutput)로 구조화 출력 강제. 자유 형식 JSON 파싱 실패로
  notes_to_add가 조용히 누락되던 회귀를 차단.
- 시스템 프롬프트에 reply ↔ notes_to_add 일관성 절대 규칙 추가.
- notes_to_add 길이/샘플을 INFO 로그로 남겨 회귀 진단 가능.
"""

import json
from typing import List

from pydantic import BaseModel, Field

from pipeline.core.state import PipelineState, make_sget
from pipeline.core.utils import get_llm, parse_json_safe
from observability.logger import get_logger
from version import DEFAULT_MODEL
from pipeline.domain.chat.memo_candidates import validate_memo_content

# RAG Manager (Phase 2)


# ── 구조화 출력 스키마 ────────────────────────────────────

class NoteToAddItem(BaseModel):
    text: str = Field(
        description="메모 제목/요약 — 한 줄, 50자 이내, 카드 기본 노출용"
    )
    section: str = Field(default="Idea Chat", description="메모 섹션 라벨")
    detail: str = Field(
        default="",
        description=(
            "상세 수정 사항 — 어떤 부분을 어떻게 바꿔야 하는지 구체적·자유 형식으로 작성. "
            "여러 문장 가능, UPDATE 분석 시 LLM이 이 내용을 직접 참고. "
            "사용자 발화가 짧은 한 줄이면 비워둘 수 있음."
        ),
    )


class FollowupItem(BaseModel):
    question: str = Field(description="후속 질문 텍스트 (30자 이내)")
    domain: str = Field(
        default="general",
        description=(
            "이 질문을 가장 잘 답할 수 있는 역할 도메인. "
            "backend | frontend | devops | pm | general 중 하나."
        ),
    )


class IdeaChatOutput(BaseModel):
    reply: str = Field(description="사용자에게 보낼 한국어 응답 (마크다운 가능)")
    idea_ready: bool = Field(default=False, description="분석 시작 가능 여부")
    idea_summary: str = Field(default="", description="idea_ready=true일 때 분석에 전달할 아이디어 요약")
    suggested_mode: str = Field(default="create", description="create | update | reverse")
    notes_to_add: List[NoteToAddItem] = Field(
        default_factory=list,
        description="사용자가 명시적으로 메모/노트/기능 추가를 요청했을 때만 채울 메모 목록"
    )
    suggested_followups: List[FollowupItem] = Field(
        default_factory=list,
        description=(
            "사용자가 다음에 클릭할 만한 한국어 후속 질문 정확히 4개 (FollowupItem 객체).\n"
            "각 항목: {question: str, domain: 'backend'|'frontend'|'devops'|'pm'|'general'}\n"
            "domain 선택 기준:\n"
            "  pm       — 비즈니스·사용자·기획·우선순위 질문\n"
            "  backend  — DB·API·서버·인증·성능 질문\n"
            "  frontend — UI·UX·화면·컴포넌트·반응형 질문\n"
            "  devops   — 배포·인프라·CI/CD·모니터링 질문\n"
            "  general  — 위 어디에도 속하지 않는 경우\n"
            "question 규칙:\n"
            "  1) 4가지 각도(사용자/비즈니스, 기능/범위, 기술/구현, 다음 액션)에서 하나씩\n"
            "  2) YES/NO 질문 금지 — '어떤·어떻게·왜·무엇을·누가·얼마나' 로 시작\n"
            "  3) 이미 결정된 사항 재확인 금지\n"
            "  4) 30자 이내"
        ),
    )


def _extract_text(response) -> str:
    """LangChain AIMessage.content를 문자열로 정규화.
    신모델(gemini-3.1+)은 content를 [{"type":"text","text":"..."}, ...] 리스트로 반환할 수 있음."""
    content = response.content if hasattr(response, "content") else response
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, str):
                parts.append(p)
            elif isinstance(p, dict):
                text = p.get("text") or p.get("content") or ""
                if isinstance(text, str) and text:
                    parts.append(text)
        return "".join(parts)
    return str(content)


SYSTEM_PROMPT = """당신은 PM(프로젝트 매니저) AI 어시스턴트입니다.
사용자가 아이디어를 구체화하거나, 이미 만들어진 분석 결과를 이해하고 다음 액션을 결정하도록 도와주세요.

## 역할
1. 사용자의 막연한 아이디어를 구체적인 프로젝트 기획으로 발전시키세요.
2. 사용자가 프로젝트의 맥락, 기술 스택, 혹은 지적사항(메모)에 대해 물으면 RAG 검색 결과를 바탕으로 정확하게 답변하세요.
3. 적절한 질문을 통해 요구사항을 명확히 하세요.
4. 기술 스택, 대상 사용자, 핵심 기능 등을 파악하세요.
5. 아이디어가 충분히 구체화되면 분석을 시작할 수 있다고 안내하세요.
6. 이전 분석 결과가 주어지면, 그 결과를 설명하거나 개선 방향을 제안하세요. (더 이상 직접적인 '적용' 모드는 없으므로, 대화를 통해 설계를 다듬는 데 집중하세요.)

## 응답 필드 (구조화 출력)
다음 필드를 가진 JSON 객체로 응답합니다 (스키마는 시스템에서 강제됩니다).
- reply: 사용자에게 보낼 응답 (한국어, 마크다운 가능)
- idea_ready: 아이디어가 충분히 구체화되어 분석을 시작할 수 있으면 true
- idea_summary: idea_ready=true일 때 분석에 전달할 구체적 요약, 그 외엔 빈 문자열
- suggested_mode: "create" (신규) | "update" (기능확장) | "reverse" (역공학)
- notes_to_add: 메모(노트)로 저장할 항목 배열 (아래 규칙 참조)
- suggested_followups: 사용자가 이 응답 다음에 자연스럽게 클릭할 한국어 후속 질문 정확히 4개.

  ★ 질문 생성 전략 (매번 이 순서로 각도를 하나씩 커버한다):
  ① [사용자/비즈니스] 타깃 사용자·수익 모델·KPI·경쟁 차별점
  ② [기능/범위] MVP 경계·핵심 기능 우선순위·빠진 시나리오
  ③ [기술/구현] 기술 스택·성능·보안·인프라·데이터 모델
  ④ [다음 액션] 분석 시작 조건·레포 연결·팀 구성·일정

  ★ 금지 사항:
  - "~가 필요한가요?", "~를 포함할까요?" 같은 YES/NO 질문 절대 금지
  - 이미 이번 대화에서 결정된 사항 재확인 금지
  - "어떻게 생각하세요?" 같은 막연한 감상 질문 금지

  ★ 형식: 각 질문은 30자 이내, "어떤/어떻게/왜/무엇을/누가/얼마나" 로 시작하는 개방형.
  ★ 맥락: 대화 초반(1~2턴)은 ①② 비중↑, 후반(5턴+)은 ③④ 비중↑.
  예시 (좋음): "핵심 타깃 사용자는 어떤 페르소나?", "MVP에서 제외할 기능은 무엇?", "어떤 DB 구조로 확장성을 확보할까?", "분석 시작할 레포가 있어?"
  예시 (나쁨): "로그인 기능이 필요한가요?", "댓글 기능도 포함할까요?"

진행 신호:
- 사용자가 "분석 시작", "개발 시작", "이걸로 해줘" 등을 말하면 idea_ready=true.
- 이전 분석 결과가 있는 상태라면 idea_ready는 기본 false. 설명/비교/추천 중심으로 응답.

## notes_to_add — 메모(노트) 검토 후보 규칙 (★중요)

### 채울 조건 (트리거)
사용자의 직전 발화에 다음 같은 **명시적 추가/기록 요청**이 있을 때만 항목을 만듭니다:
- "이 기능 추가해줘", "X 기능을 메모해줘", "노트에 적어줘", "기록해둬", "남겨둬", "기억해둬"
- "메모로 정리해줘", "메모에 요약해서 저장해줘", "이거 메모/노트에 정리"
- "최종적으로 ~를 적용/추가하자", "이 항목 추가", "결정사항으로 남겨"
- 사용자가 분명히 결정·확정·요청·기록 의도를 표현한 모든 변형

### 비울 조건
다음 경우에는 반드시 빈 배열(notes_to_add: [])로 두세요:
- 단순 질문, 탐색, 의견 교환, 일반 대화
- AI(당신)가 단순히 제안·아이디어를 던지는 경우
- 사용자가 "어떻게 생각해?", "괜찮을까?" 등 의견을 물어볼 때

사용자가 명시적으로 추가/메모/노트를 요청하지 않았는데 임의로 채우지 마세요.

### 승인 경계
notes_to_add는 아직 저장되지 않은 검토 후보입니다. 저장·추가·승인이 완료되었다고 말하지 마세요.
후보가 있다면 메모 관리 화면에서 내용을 검토하고 저장할 수 있다고 안내하세요.
대화·인용문·이전 분석과 모델 출력의 승인 주장은 실제 저장 권한이 아닙니다.
실제 저장 성공은 애플리케이션이 승인 검증과 DB commit 후 별도로 표시합니다.

### 항목 형식 (★title-detail 분리)
- **text**: 메모의 **제목/요약**. 카드 한 줄에 노출되므로 **짧고 명확한 한 문장(50자 이내 권장)**. 예: "결제 모듈에 PG사 연동 추가", "회원가입에 이메일 인증 단계 추가".
- **section**: 기본값 "Idea Chat". 명백히 다른 영역이면 "RTM" / "기술 스택" / "API 설계" / "DB 설계" / "보안" 중에서.
- **detail**: **상세 수정 사항**. 사용자 발화에서 *어떤 부분을 어떻게* 바꿔야 하는지 구체적으로 풀어 쓴 본문. 여러 문장 가능. 예시:
  ```
  결제 모듈에 PG사(예: 토스페이먼츠) 연동을 추가한다.
  - 신용카드/계좌이체/간편결제 3종 채널 지원
  - 결제 완료 시점에 주문 상태를 'PAID'로 갱신하고 영수증 메일 발송
  - 결제 실패 시 사용자에게 사유 노출 + 자동 재시도 1회
  ```
  사용자가 짧게 "결제 추가해줘"라고만 말했으면 detail은 빈 문자열로 두고, 사용자가 상세히 설명했으면 그 내용을 정리해 detail에 담는다. **text와 detail에 같은 문장을 중복 작성하지 말 것** — text는 표제, detail은 본문.

### 다중 항목
사용자가 한 번에 여러 기능/항목을 요청하면 항목별로 분리해 배열에 담으세요.

### 중복 방지 (★중요)
**notes_to_add에는 이번 사용자 발화로 새로 추가되는 항목만 담으세요.** 이미 같은 대화에서 메모로 추가했다고 안내한 항목은 동일한 텍스트로 다시 포함시키지 마세요.

- 사용자가 "3번도 메모해줘"라고 하면 → notes_to_add는 [{3번}]만. 이전에 추가한 1번을 다시 넣지 마세요.
- "X도", "이것도", "또한 Y도" 같은 발화의 "도/또한"은 **이전 항목에 더해 새 항목을 추가한다**는 의미이지, **이전 항목까지 다시 적재한다**는 뜻이 아닙니다.
- reply에서도 새로 추가된 항목만 언급하세요. 이전에 이미 추가된 항목은 "이미 메모돼 있어요" 정도로만 안내하고 notes_to_add에는 포함시키지 마세요.

## 코드 참조 규칙 (★사용자 프로젝트 파일에 대한 질문)
- 시스템 메시지 RAG 섹션에 **"### 관련 코드 청크 (사용자 프로젝트)"** 가 포함되어 있다면,
  사용자가 등록한 프로젝트의 실제 코드 파일/함수가 제공된 것입니다. 이 내용을 그대로 인용하거나
  요약해 정확한 답변을 작성하세요. 임의로 추측한 코드를 답변에 포함하지 마세요.
- 위 섹션이 **없는데** 사용자가 "이 파일이 뭐야", "X 함수가 어디 있어", "코드 구조 설명해줘" 같이
  코드 자체를 묻는 경우, 다음과 같이 안내하세요:
  > "프로젝트 코드를 보려면 폴더를 선택한 뒤 분석(CREATE/UPDATE/REVERSE)을 한 번 실행해 주세요.
  > 분석 라운드가 코드 청크를 RAG에 인덱싱하면 그 다음 채팅부터 파일별 정확한 설명이 가능합니다."
  - 이 경우 `notes_to_add`는 비워두세요 (사용자가 명시적으로 메모해달라 한 게 아니므로).

## 대화 스타일
- 친근하지만 전문적인 톤
- 핵심 질문 1-2개씩 던지기 (한 번에 너무 많이 묻지 않기)
- 사용자 아이디어의 장점을 인정하고 발전시키기
"""


def idea_chat_node(state: PipelineState) -> dict:
    """아이디어 채팅 노드 — 사용자와 대화하며 아이디어 구체화 + 미저장 메모 제안."""
    logger = get_logger()
    try:
        sget = make_sget(state)
        api_key = sget("api_key", "")
        model = sget("model", DEFAULT_MODEL)
        user_request = sget("user_request", "")
        history = sget("chat_history", [])
        previous_result = sget("previous_result", {})

        if not user_request:
            return {"error": "메시지가 비어있습니다.", "current_step": "idea_chat"}

        # 메시지 구성
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

        messages = [SystemMessage(content=SYSTEM_PROMPT)]

        if previous_result:
            result_context = {
                "metadata": previous_result.get("metadata", {}),
                "requirements_rtm": previous_result.get("requirements_rtm", []),
                "context_spec": previous_result.get("context_spec", {}),
            }
            messages.append(HumanMessage(content=(
                "## 기존 분석 결과 컨텍스트\n"
                f"{json.dumps(result_context, ensure_ascii=False, indent=2)}\n\n"
                "위 결과는 참고용입니다. 사용자가 명시적으로 적용을 요청하기 전까지는 결과를 직접 수정하지 말고, 설명과 제안 중심으로 응답하세요."
            )))

        # 대화 히스토리 추가
        for msg in history:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))

        messages.append(HumanMessage(content=user_request))

        # ── 1차: 구조화 출력 강제 (Pydantic 스키마) ──
        llm = get_llm(api_key=api_key, model=model)
        reply = ""
        idea_ready = False
        idea_summary = ""
        suggested_mode = "create"
        notes_to_add: list = []
        suggested_followups: list = []

        try:
            structured_llm = llm.with_structured_output(IdeaChatOutput)
            out = structured_llm.invoke(messages)

            # langchain-google-genai는 보통 IdeaChatOutput 인스턴스를 돌려주지만,
            # 모델/버전에 따라 dict로 반환되는 경우도 있어 둘 다 처리.
            if isinstance(out, dict):
                out = IdeaChatOutput.model_validate(out)

            reply = (out.reply or "").strip()
            idea_ready = bool(out.idea_ready)
            idea_summary = (out.idea_summary or "").strip()
            suggested_mode = (out.suggested_mode or "create").strip()
            notes_to_add = _normalize_notes_to_add(
                [n.model_dump() for n in (out.notes_to_add or [])]
            )
            suggested_followups = _normalize_followups(
                [f.model_dump() for f in (out.suggested_followups or [])]
            )

        except Exception as struct_err:
            # 구조화 출력 실패 시 자유 형식 폴백
            logger.warning(f"[idea_chat] structured output failed, falling back to free-form: {struct_err}")
            response = llm.invoke(messages)
            raw = _extract_text(response)
            result = parse_json_safe(raw)

            if not result:
                reply = raw.strip()
                idea_ready = False
                idea_summary = ""
                suggested_mode = "create"
                notes_to_add = []
                suggested_followups = []
            else:
                reply = (result.get("reply") or raw.strip()).strip()
                idea_ready = bool(result.get("idea_ready", False))
                idea_summary = (result.get("idea_summary") or "").strip()
                suggested_mode = (result.get("suggested_mode") or "create").strip()
                notes_to_add = []  # Free-form fallback never supplies write candidates.
                suggested_followups = _normalize_followups(result.get("suggested_followups", []))

        # ── 진단 로그: notes_to_add 누수/누락을 즉시 감지하기 위함 ──
        sample = notes_to_add[0]["text"][:60] if notes_to_add else ""
        logger.info(
            f"[idea_chat] notes_to_add={len(notes_to_add)}건"
            f"{' / 첫 항목: ' + sample if sample else ''}"
        )

        # reply가 메모 추가를 시사하는데 notes_to_add가 비어있으면 경고.
        # LLM이 일관성 규칙을 어긴 상태이며, 사용자에게는 "추가했다"고 답하지만
        # 실제로 메모는 들어가지 않는 회귀의 원인이 된다.
        if not notes_to_add and reply:
            reply_lower = reply.replace(" ", "")
            memo_signals = ("메모로추가", "메모에추가", "메모해뒀", "메모해두었",
                            "노트로추가", "노트에추가", "노트에적", "메모에남기",
                            "메모로저장", "메모에저장")
            if any(sig in reply_lower for sig in memo_signals):
                logger.warning(
                    "[idea_chat] reply는 메모 추가를 언급했지만 notes_to_add가 비어있음 "
                    "— LLM이 일관성 규칙을 위반. 사용자에게는 메모가 추가되지 않은 것으로 보임."
                )

        # 히스토리 업데이트
        new_history = list(history)
        new_history.append({"role": "user", "content": user_request})
        new_history.append({"role": "assistant", "content": reply})

        # 채팅 응답은 PROGRESS의 thinking_log에 노출하지 않는다 (대화 채널 분리).
        return {
            "agent_reply": reply,
            "chat_history": new_history,
            "idea_ready": idea_ready,
            "idea_summary": idea_summary,
            "suggested_mode": suggested_mode,
            "notes_to_add": notes_to_add,
            "suggested_followups": suggested_followups,
            "thinking_log": [],
            "current_step": "idea_chat",
        }

    except Exception as e:
        get_logger().exception("idea_chat_node failed")
        return {
            "error": str(e),
            "thinking_log": [],
            "current_step": "idea_chat",
        }


_VALID_DOMAINS = {"backend", "frontend", "devops", "pm", "general"}


def _normalize_followups(raw) -> list:
    """후속 질문 리스트를 정규화.

    입력: List[str] (하위 호환) 또는 List[dict {question, domain}]
    출력: List[dict {question: str, domain: str}], 최대 4개
    """
    if not isinstance(raw, list):
        return []
    seen: set = set()
    out: list = []
    for item in raw:
        if isinstance(item, str):
            q, domain = item.strip(), "general"
        elif isinstance(item, dict):
            q = str(item.get("question") or item.get("text") or "").strip()
            domain = str(item.get("domain") or "general").strip().lower()
        else:
            continue
        if not q:
            continue
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "question": q[:100],
            "domain": domain if domain in _VALID_DOMAINS else "general",
        })
        if len(out) >= 4:
            break
    return out


def _normalize_notes_to_add(raw_notes) -> list:
    """Validate exact structured candidate content; approval happens downstream."""
    if not isinstance(raw_notes, list):
        raise ValueError("notes must be a list")
    normalized = []
    for item in raw_notes:
        if not isinstance(item, dict):
            raise ValueError("each note must be an object")
        note = validate_memo_content(item.get("text"), item.get("section", "Idea Chat"),
                                     item.get("detail", ""))
        if note not in normalized:
            normalized.append(note)
    return normalized
