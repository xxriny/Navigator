import React, { useState } from "react";
import { apiBaseUrl } from "../../api/apiClient";
import useAppStore from "../../store/useAppStore";

export default function MemoProposalReview({ proposal, onDismiss }) {
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [savedCount, setSavedCount] = useState(null);
  const expired = Date.now() >= proposal.expires_at * 1000;
  const sameContext = (state) => {
    const current = useAppStore.getState();
    return current.authToken === state.authToken &&
      current.currentUser?.id === state.currentUser?.id &&
      current.currentUser?.team_id === state.currentUser?.team_id &&
      current.serverSessionId === state.serverSessionId;
  };
  const closeReview = async () => {
    const state = useAppStore.getState();
    if (state.serverSessionId !== proposal.session_id || state.currentUser?.id !== proposal.actor_id) return;
    setBusy(true);
    try {
      const refreshed = await state.syncMemos();
      if (!sameContext(state)) return;
      if (!refreshed) { setError("메모 목록을 확인하지 못했습니다. 연결을 확인하고 검토 닫기를 다시 눌러주세요."); return; }
      if (sameContext(state)) onDismiss(proposal.proposal_id);
    } catch (e) {
      if (sameContext(state)) setError(`메모 목록을 확인하지 못했습니다: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const act = async (action) => {
    if (busy || expired || needsReview) return;
    const state = useAppStore.getState();
    if (state.serverSessionId !== proposal.session_id || state.currentUser?.id !== proposal.actor_id) {
      setError("프로젝트 또는 계정이 변경되었습니다. 다시 검토하세요.");
      return;
    }
    if (!state.backendPort || !state.authToken) {
      setError("백엔드 연결과 로그인을 확인하세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl(state.backendPort)}/api/memo-proposals/${proposal.proposal_id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.authToken}` },
        ...(action === "approve" ? { body: JSON.stringify({ selected_ids: selected }) } : {}),
      });
      const body = await response.json();
      if (!response.ok || body.status !== "ok") throw new Error(body.detail || body.error || "저장 결과를 확인할 수 없습니다.");
      if (!sameContext(state)) return;
      if (action === "approve") {
        setSavedCount(body.data.created);
        state.addNotification(`메모 ${body.data.created}건을 저장했습니다.`, "success", 3000);
        // Fetch committed rows only. Never fabricate a saved memo from the proposal.
        const refreshed = await state.syncMemos();
        if (!sameContext(state)) return;
        if (!refreshed) {
          setNeedsReview(true);
          setError("저장은 완료됐지만 메모 목록을 불러오지 못했습니다. 연결을 확인하고 검토 닫기를 눌러주세요.");
          return;
        }
      }
      if (sameContext(state)) onDismiss(proposal.proposal_id);
    } catch (e) {
      if (!sameContext(state)) return;
      setNeedsReview(true);
      setError(`${e.message} 저장 결과가 확정되지 않았습니다. 검토를 닫아 저장 목록을 확인하고, 필요한 항목만 다시 제안받으세요.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="border border-amber-500/40 rounded-xl p-4 space-y-3">
      <h3 className="font-bold">{savedCount !== null ? `메모 ${savedCount}건 저장 완료` : needsReview ? "메모 제안 · 저장 결과 확인 필요" : "메모 제안 · 아직 저장되지 않음"}</h3>
      <p className="text-sm opacity-70">내용을 확인하고 저장할 항목을 선택하세요. 선택하지 않은 항목은 저장되지 않습니다.</p>
      <p className="text-xs opacity-60">프로젝트: {proposal.session_id} · 검토 기한: {new Date(proposal.expires_at * 1000).toLocaleTimeString()}</p>
      {proposal.items.map(({ item_id, content }) => (
        <label key={item_id} className="block border rounded-lg p-3 cursor-pointer">
          <input type="checkbox" disabled={busy || expired || needsReview} checked={selected.includes(item_id)}
            onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, item_id] : ids.filter((id) => id !== item_id))} />
          <span className="ml-2 text-xs opacity-70">{content.section}</span>
          <div className="whitespace-pre-wrap font-medium">{content.text}</div>
          {content.detail && <pre className="whitespace-pre-wrap text-sm mt-2 font-sans">{content.detail}</pre>}
        </label>
      ))}
      {expired && <p role="alert">검토 기한이 지났습니다. 채팅에서 다시 제안받으세요.</p>}
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button disabled={busy || expired || needsReview || !selected.length} onClick={() => act("approve")}
          className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-40">선택한 {selected.length}건 저장</button>
        <button disabled={busy} onClick={() => needsReview ? closeReview() : expired ? onDismiss(proposal.proposal_id) : act("cancel")}
          className="px-3 py-2 border rounded">{needsReview ? "검토 닫기" : "제안 취소"}</button>
      </div>
    </section>
  );
}
