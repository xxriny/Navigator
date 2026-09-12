"""
Pipeline Orchestration 계층 
WebSocket 핸들러에서 파이프라인 실행 로직을 분리.
_ws_run_* 시리즈 + 스트리밍 로직을 단일 모듈에서 관리.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime

from fastapi import WebSocket

from pipeline.orchestration.facade import (
    get_idea_pipeline,
    get_pm_pipeline,
    get_sa_pipeline,
    get_pm_routing_map,
    get_sa_routing_map,
    get_idea_chat_routing_map,
)
from pipeline.core.action_type import normalize_action_type
from pipeline.core.ast_scanner import extract_functions, summarize_for_llm
from result_shaping.result_shaper import shape_result
from pipeline.core.utils import to_serializable, active_jwt_token
from observability.logger import get_logger
from observability.metrics import track_node
from transport.connection_manager import manager
from version import DEFAULT_MODEL

# 인증 및 레포 캐시 추가
from auth.database import SessionLocal
from auth.service import decode_token, get_user_by_id
from connectors.repo_cache import is_github_repo_format, get_local_repo_path


# ─── 입력 검증 ────────────────────────────────────────────

def validate_analysis_inputs(action_type: str, idea: str, source_dir: str) -> str | None:
    """모드별 필수 입력 검증. 에러 메시지 또는 None 반환."""
    normalized = normalize_action_type(action_type)
    idea_text = (idea or "").strip()
    source_path = (source_dir or "").strip()

    if normalized == "REVERSE_ENGINEER" and not source_path:
        return "역공학 모드입니다. 먼저 폴더를 선택하세요."
    if normalized in {"CREATE", "UPDATE"} and not idea_text:
        return "신규 기획/기능 확장 모드에서는 아이디어 입력이 필요합니다."
    return None


def _parse_package_json(content: str, _: str) -> str:
    try:
        pkg = json.loads(content)
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        top = list(deps.keys())[:30]
        return f"[package.json] name={pkg.get('name', '?')}, deps={top}"
    except Exception:
        return ""


def _parse_requirements_txt(content: str, _: str) -> str:
    pkgs = [
        ln.split("==")[0].split(">=")[0].split(">")[0].strip()
        for ln in content.splitlines()
        if ln.strip() and not ln.startswith("#")
    ]
    return f"[requirements.txt] {pkgs[:30]}" if pkgs else ""


def _parse_pyproject_toml(content: str, _: str) -> str:
    return f"[pyproject.toml]\n{content[:2000]}"


def _parse_plain_text(content: str, filename: str) -> str:
    return f"[{filename}]\n{content[:1000]}"


def _read_dependency_files(source_path: str) -> str:
    """package.json, requirements.txt 등 의존성 파일을 읽어 요약 반환."""
    candidates = [
        ("package.json",      _parse_package_json),
        ("requirements.txt",  _parse_requirements_txt),
        ("pyproject.toml",    _parse_pyproject_toml),
        ("Pipfile",           _parse_plain_text),
        ("go.mod",            _parse_plain_text),
        ("pom.xml",           _parse_plain_text),
        ("build.gradle",      _parse_plain_text),
    ]
    lines = []
    for filename, parser in candidates:
        full_path = os.path.join(source_path, filename)
        if os.path.isfile(full_path):
            try:
                with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read(4000)
                parsed = parser(content, filename)
                if parsed:
                    lines.append(parsed)
            except Exception:
                pass
    return "\n".join(lines)


def build_reverse_context(source_dir: str) -> tuple[str, dict]:
    """source_dir AST 스캔 + 의존성 파일 → (project_context 문자열, code_inventory dict).

    code_inventory: {file_path: [{name, summary}]} — SA 노드에서 직접 소비.
    스캔을 한 번만 수행해서 context와 inventory를 동시에 생성한다.
    """
    source_path = (source_dir or "").strip()
    if not source_path:
        return "", {}

    dep_summary = _read_dependency_files(source_path)

    functions = extract_functions(source_path, max_functions=250)
    unique_files = len({fn.get("file", "") for fn in functions if fn.get("file")})
    summary = summarize_for_llm(functions, max_chars=6000) if functions else "(함수 없음)"

    code_inventory: dict = {}
    for fn in functions:
        fp = fn.get("file", "")
        if fp:
            code_inventory.setdefault(fp, []).append(
                {"name": fn.get("name", ""), "summary": fn.get("summary", "")}
            )

    parts = [
        "아래는 로컬 프로젝트 정적 스캔 결과입니다. "
        "이 정보를 기준으로 프로젝트 구조, 핵심 모듈, 기술 스택, 유지보수 리스크를 분석하세요.\n",
        f"- source_dir: {source_path}",
        f"- scanned_files: {unique_files}",
        f"- scanned_functions: {len(functions)}",
    ]
    if dep_summary:
        parts.append("\n[의존성 파일 요약]")
        parts.append(dep_summary)
    parts.append("\n[함수 요약]")
    parts.append(summary)

    return "\n".join(parts), code_inventory


def _inject_previous_artifacts(state: dict, project_context: str) -> None:
    """UPDATE 모드: project_context JSON에서 이전 artifact를 파싱하여 state에 주입."""
    import json as _json
    log = get_logger()
    try:
        start = project_context.find("{")
        if start < 0:
            log.warning("_inject_previous_artifacts: project_context에서 JSON을 찾지 못했습니다.")
            return
        prev = _json.loads(project_context[start:])

        # stack_planner: global_stacks(gs) 원본 우선 → tech_stacks(feature별 매핑) 폴백
        spo = prev.get("stack_planner_output") or {}
        gs = spo.get("gs") or spo.get("global_stacks") or []
        if not gs:
            gs = prev.get("tech_stacks") or []
        if gs:
            state["previous_global_stacks"] = gs

        # sa_test_analysis: 이전 테스트 전략
        ta = prev.get("sa_test_analysis_output") or (
            (prev.get("sa_arch_bundle") or {}).get("data", {}).get("test_strategy")
        )
        if ta:
            state["previous_test_cases"] = ta

        # sa_project_structure: 이전 디렉토리 구조
        ps = prev.get("sa_project_structure") or prev.get("sa_project_structure_output")
        if ps:
            state["previous_project_structure"] = ps

    except Exception as e:
        log.warning(f"_inject_previous_artifacts 파싱 실패 (UPDATE 계속 진행): {e}")


def analysis_pipeline_type(action_type: str) -> str:
    normalized = normalize_action_type(action_type)
    if normalized == "REVERSE_ENGINEER":
        return "analysis_reverse"
    if normalized == "UPDATE":
        return "analysis_update"
    return "analysis_create"


async def _run_pipeline_base(
    ws: WebSocket,
    *,
    pipeline,
    routing: dict,
    state_payload: dict,
    pipeline_type: str,
    result_node: str = "complete",
    save: bool = True,
    result_mutator=None,
    persistence_context=None,
    log=None,
) -> dict:
    """공통 파이프라인 실행, 결과 정형화, 전송, 저장 처리.
    연속 실행을 위해 최종 결과를 반환함.
    """
    try:
        result = await stream_pipeline_updates(ws, pipeline, state_payload, routing=routing)

        if result.get("error"):
            await manager.send_json(ws, {"type": "error", "data": {"message": result["error"]}})
            return result

        # 중간 단계에서는 저장을 스킵할 수 있음 (save=False)
        if save:
            shaped = shape_result(result)
            shaped["pipeline_type"] = pipeline_type
            if result_mutator is not None:
                result_mutator(shaped)

            # 최종 결과를 로컬 DB에 영속화
            if not persistence_context:
                raise ValueError("Authenticated project context is required for result persistence")
            shaped = _persist_analysis_result(persistence_context["run_id"], shaped, persistence_context)

            await manager.send_json(ws, {"type": "result", "node": result_node, "data": shaped})
        
        return result

    except Exception as e:
        get_logger().exception("pipeline execution failed")
        await manager.send_json(ws, {"type": "error", "data": {"message": str(e)}})
        return {"error": str(e)}


# ─── WebSocket 파이프라인 실행 ────────────────────────────

async def run_analysis(ws: WebSocket, payload: dict) -> None:
    api_key = payload.get("api_key", "")
    model = payload.get("model", DEFAULT_MODEL)
    idea = payload.get("idea", "")
    context = payload.get("context", "")
    action_type = normalize_action_type(payload.get("action_type", "CREATE"))
    source_dir = payload.get("source_dir", "")
    auth_token = payload.get("auth_token", "")
    # UPDATE 모드에서 이전 RTM/features를 그대로 받아 위치·ID 보존에 사용
    previous_features = payload.get("previous_features") or []

    # Gemini 키 fetch 시 Cloud Run 인증에 사용할 JWT를 ContextVar에 설정
    active_jwt_token.set(auth_token)

    get_logger().info("run_analysis_payload", action_type=action_type, source_dir=source_dir, idea=idea[:50])

    # Bind project ownership outside model-controlled state before any pipeline work.
    from auth.deps import get_current_user_optional
    from auth.database import SharedSessionLocal
    from pipeline.domain.chat.memo_approval import authorize_session
    project_id = payload.get("project_session_id") or ""
    try:
        with SessionLocal() as db, SharedSessionLocal() as shared_db:
            user = get_current_user_optional(token=auth_token, db=shared_db)
            project = authorize_session(db, shared_db, user, project_id)
            if user.role != "pm":
                raise ValueError("LLM 분석은 PM 권한이 필요합니다.")
            if project.team_id:
                authorize_session(db, shared_db, user, project_id, pm=True)
            actor_id = user.id
            github_oauth_token = user.github_oauth_token if is_github_repo_format(source_dir) else None
    except Exception as exc:
        await manager.send_json(ws, {"type": "error", "data": {"message": getattr(exc, "detail", None) or str(exc)}})
        return

    # ── GitHub 레포지토리인 경우 캐싱 처리 ──
    if is_github_repo_format(source_dir):
        try:
            await manager.send_json(ws, {
                "type": "thinking",
                "node": "repo_loader",
                "data": {"text": f"GitHub 저장소({source_dir})를 준비 중입니다..."}
            })
            owner, repo = source_dir.split("/")
            # 동기 함수이므로 asyncio.to_thread 사용 (git clone/pull은 블로킹 작업)
            source_dir = await asyncio.to_thread(
                get_local_repo_path, owner, repo, github_oauth_token
            )
            get_logger().info("github_repo_cached", path=source_dir)
        except Exception as e:
            await manager.send_json(ws, {
                "type": "error",
                "data": {"message": f"저장소 준비 실패: {str(e)}"}
            })
            return

    validation_error = validate_analysis_inputs(action_type, idea, source_dir)
    if validation_error:
        await manager.send_json(ws, {"type": "error", "data": {"message": validation_error}})
        return

    # REVERSE_ENGINEER: AST 스캔으로 project_context + code_inventory 동시 빌드 (단일 스캔)
    # UPDATE: 코드 스캔 불필요 — 이전 설계 artifact(context)가 진실 소스
    code_inventory: dict = {}
    if action_type == "REVERSE_ENGINEER" and source_dir:
        context, code_inventory = await asyncio.to_thread(build_reverse_context, source_dir)
        if not context:
            await manager.send_json(ws, {
                "type": "error",
                "data": {"message": "선택한 폴더에서 분석 가능한 함수/메서드를 찾지 못했습니다. 프로젝트 루트를 확인하세요."},
            })
            return

    from uuid import uuid4
    run_id = str(uuid4())
    log = get_logger(run_id)
    log.info("analysis_start", action_type=action_type)

    initial_state = {
        "api_key": api_key,
        "model": model,
        "input_idea": idea,
        "project_context": context,
        "source_dir": source_dir,
        "action_type": action_type,
        "run_id": run_id,
        "previous_features": previous_features,
    }

    if action_type == "REVERSE_ENGINEER" and code_inventory:
        initial_state["code_inventory"] = code_inventory

    if action_type == "UPDATE" and (context or "").strip():
        _inject_previous_artifacts(initial_state, context)

    # 1. PM Pipeline (Stage 1) - 요구사항 원자화 및 기획
    pm_result = await _run_pipeline_base(
        ws,
        pipeline=get_pm_pipeline(),
        routing=get_pm_routing_map(),
        state_payload=initial_state,
        pipeline_type="pm_only",
        save=False,
        log=log,
    )

    if pm_result.get("error"):
        return

    pm_result["run_id"] = run_id  # Preserve handler-assigned identity across model stages.

    # 2. SA Pipeline (Stage 2) - 아키텍처 설계
    sa_result = await _run_pipeline_base(
        ws,
        pipeline=get_sa_pipeline(),
        routing=get_sa_routing_map(),
        state_payload=pm_result,
        pipeline_type=analysis_pipeline_type(action_type),
        result_node="complete",
        save=True,
        persistence_context={"run_id": run_id, "project_id": project_id, "actor_id": actor_id, "auth_token": auth_token},
        log=log,
    )


async def run_idea_chat(ws: WebSocket, payload: dict) -> None:
    api_key = payload.get("api_key", "")
    model = payload.get("model", DEFAULT_MODEL)
    active_jwt_token.set(payload.get("auth_token", ""))

    # 채팅에서 만들어진 메모를 묶어두는 session_id.
    # 프론트가 currentSessionId를 보내면 그것에 묶어 영속화하고,
    # 비어 있으면(=활성 프로젝트 없음) 메모 영속화 자체를 스킵해 chat_global 누적을 차단.
    chat_session_id = (payload.get("session_id") or "").strip()

    # Authenticate before invoking the model, not only when it proposes a memo.
    from auth.deps import get_current_user_optional
    from auth.database import SharedSessionLocal
    from pipeline.domain.chat.memo_approval import authorize_session
    try:
        with SessionLocal() as db, SharedSessionLocal() as shared_db:
            user = get_current_user_optional(token=payload.get("auth_token", ""), db=shared_db)
            authorize_session(db, shared_db, user, chat_session_id)
    except Exception as exc:
        await manager.send_json(ws, {"type": "error", "data": {"message": getattr(exc, "detail", None) or str(exc)}})
        return

    result = await _run_pipeline_base(
        ws,
        pipeline=get_idea_pipeline(),
        routing=get_idea_chat_routing_map(),
        state_payload={
            "api_key": api_key,
            "model": model,
            "user_request": payload.get("message", ""),
            "chat_history": payload.get("chat_history", []),
            "previous_result": payload.get("previous_result", {}),
        },
        pipeline_type="idea_chat",
        result_node="idea_chat",
        save=False,
    )

    if result.get("error"):
        return

    # 진단: aggregated state에 어떤 키들이 도달했는지 확인
    # (이전 회귀: notes_to_add가 PipelineState 스키마 누락으로 LangGraph가 drop)
    get_logger().info(
        f"[idea_chat] aggregated keys: {sorted(result.keys())}, "
        f"notes_to_add type={type(result.get('notes_to_add')).__name__}"
    )

    # Model output is a review candidate, never a database write request.
    raw_notes = result.get("notes_to_add") or []
    memo_proposal = None
    memo_proposal_error = None
    if raw_notes:
        try:
            from auth.deps import get_current_user_optional
            from auth.database import SharedSessionLocal
            from pipeline.domain.chat.memo_approval import issue_memo_proposal
            with SessionLocal() as db, SharedSessionLocal() as shared_db:
                user = get_current_user_optional(token=payload.get("auth_token", ""), db=shared_db)
                memo_proposal = issue_memo_proposal(db, shared_db, user, chat_session_id, raw_notes)
        except Exception as exc:
            memo_proposal_error = getattr(exc, "detail", None) or "메모 제안을 준비하지 못했습니다. 다시 시도하세요."
            get_logger().warning("[idea_chat] memo review unavailable; no memo saved")

    await manager.send_json(ws, {
        "type": "result",
        "node": "idea_chat",
        "data": {
            "chat_reply": result.get("agent_reply", ""),
            "chat_history": result.get("chat_history", []),
            "idea_ready": result.get("idea_ready", False),
            "idea_summary": result.get("idea_summary", ""),
            "suggested_mode": result.get("suggested_mode", "create"),
            "notes_to_add": [],  # Legacy clients must never mistake candidates for saved memos.
            "memo_proposal": memo_proposal,
            "memo_proposal_error": memo_proposal_error,
            "suggested_followups": result.get("suggested_followups", []),
            "pipeline_type": "idea_chat",
        },
    })


# ─── 스트리밍 ─────────────────────────────────────────────

async def stream_pipeline_updates(
    ws: WebSocket,
    pipeline,
    payload: dict,
    *,
    routing: dict,
) -> dict:
    """파이프라인 astream을 소비하며 WS로 실시간 상태를 브로드캐스트한다.

    Args:
        routing: get_pipeline_routing_map() 반환값
                 {"first_node": str, "next_nodes": dict, "start_message": str}
    """
    first_node: str = routing["first_node"]
    next_nodes: dict[str, list[str]] = routing["next_nodes"]
    start_message: str = routing.get("start_message", "파이프라인 시작...")
    action_type: str = payload.get("action_type", "unknown")

    aggregated: dict = {**payload}
    seen_thinking: set[tuple[str, str]] = set()

    await manager.send_json(ws, {
        "type": "status",
        "node": first_node,
        "data": {"status": "running", "message": start_message},
    })

    async for update in pipeline.astream(payload, config={"recursion_limit": 150}, stream_mode="updates"):
        if not isinstance(update, dict):
            continue

        for node_name, node_result in update.items():
            with track_node(node_name, action_type):
                ser = to_serializable(node_result)
                if not isinstance(ser, dict):
                    continue

                _merge_state(aggregated, ser)
                await _emit_thinking(ws, ser.get("thinking_log", []), seen_thinking)

                node_error = ser.get("error")
                if node_error:
                    await manager.send_json(ws, {
                        "type": "status",
                        "node": node_name,
                        "data": {"status": "error"},
                    })
                    aggregated["error"] = node_error
                    return aggregated

                await manager.send_json(ws, {
                    "type": "status",
                    "node": node_name,
                    "data": {"status": "done"},
                })

                for next_node in next_nodes.get(node_name, []):
                    await manager.send_json(ws, {
                        "type": "status",
                        "node": next_node,
                        "data": {"status": "running"},
                    })

                await asyncio.sleep(0)

    return aggregated


async def _emit_thinking(
    ws: WebSocket,
    thinking_log: list,
    seen: set[tuple[str, str]],
) -> None:
    for entry in thinking_log or []:
        if not isinstance(entry, dict):
            continue
        node_name = str(entry.get("node", "")) or "unknown"
        text = str(entry.get("thinking", ""))
        key = (node_name, text)
        if key in seen:
            continue
        seen.add(key)
        await manager.send_json(ws, {
            "type": "thinking",
            "node": node_name,
            "data": {"text": text},
        })


def _persist_analysis_result(run_id: str, shaped: dict, context: dict) -> dict:
    """Commit owned results before emitting success. Never trust model owner fields."""
    from auth.database import SharedSessionLocal
    from pipeline.domain.chat.project_sessions import persist_owned_result
    with SessionLocal() as db, SharedSessionLocal() as shared_db:
        from auth.deps import get_current_user_optional
        user = get_current_user_optional(token=context.get("auth_token", ""), db=shared_db)
        if user is None or user.id != context["actor_id"]:
            raise ValueError("분석 저장 전에 인증 상태가 변경되었습니다.")
        return persist_owned_result(db, shared_db, user, context["project_id"], run_id, shaped)


def _merge_state(target: dict, source: dict) -> None:
    for key, value in source.items():
        if key == "thinking_log":
            existing = target.get(key, [])
            if isinstance(existing, list) and isinstance(value, list):
                target[key] = existing + [e for e in value if e not in existing]
            else:
                target[key] = value
            continue
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            target[key] = {**target[key], **value}
            continue
        target[key] = value
