import React, { useState } from "react";
import useAppStore from "../../store/useAppStore";
import { apiBaseUrl } from "../../api/apiClient";

const LABELS = { title: "제목", description: "내용", area: "영역", effort: "공수", task_type: "유형" };

export default function TaskProposalReview({ proposal, onDone }) {
  const isAssignment = proposal.kind === "task.assignment";
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const missingRequired = proposal.items.some((i) => i.content.security && !selected.includes(i.item_id));
  const expired = Date.now() >= proposal.expires_at * 1000;
  const act = async (action) => {
    const state = useAppStore.getState();
    if (state.currentUser?.id !== proposal.actor_id || state.currentUser?.team_id !== proposal.team_id ||
        (!isAssignment && state.resultData?.run_id !== proposal.session_id)) {
      setError("계정·팀·분석 결과가 변경되었습니다. 다시 검토하세요."); return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiBaseUrl(state.backendPort)}/api/${isAssignment ? "assignment-proposals" : "task-proposals"}/${proposal.proposal_id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.authToken}` },
        ...(action === "approve" ? { body: JSON.stringify({ selected_ids: selected }) } : {}),
      });
      const body = await response.json();
      if (!response.ok || body.status !== "ok") throw new Error(body.detail || body.error || "승인 처리 실패");
      const current = useAppStore.getState();
      if (current.authToken !== state.authToken || current.currentUser?.id !== proposal.actor_id ||
          current.currentUser?.team_id !== proposal.team_id || (!isAssignment && current.resultData?.run_id !== proposal.session_id)) return;
      onDone(action === "approve" ? (isAssignment ? `배분 완료: ${body.data.assigned}개` : `저장 완료: 신규 ${body.data.created}개, 수정 ${body.data.updated}개`) : "제안을 취소했습니다.");
    } catch (e) { setNeedsReview(true); setError(`${e.message} 현재 태스크를 확인하고 다시 검토하세요.`); }
    finally { setBusy(false); }
  };
  return (
    <section className="border border-amber-500/40 rounded-xl p-4 space-y-3 max-h-[60vh] overflow-auto">
      <h3 className="font-bold">{isAssignment ? "배분안 검토 · 아직 적용되지 않음" : "태스크 제안 검토 · 아직 저장되지 않음"}</h3>
      <p className="text-xs opacity-70">{isAssignment ? "선택한 태스크의 담당자를 지정하고 수락 대기 상태로 변경합니다. 태스크 본문은 변경하지 않습니다." : "선택한 신규 태스크는 미할당으로 저장됩니다. 기존 태스크 수정은 표시된 변경 내용만 적용합니다."}</p>
      <p className="text-xs opacity-60">{isAssignment ? "팀" : "분석"}: {proposal.session_id} · 검토 기한: {new Date(proposal.expires_at * 1000).toLocaleTimeString()}</p>
      {proposal.items.map(({ item_id, content }) => (
        <div key={item_id} className="border rounded-lg p-3 space-y-2">
          <label className="flex gap-2 items-center font-bold">
            <input type="checkbox" disabled={busy || expired} checked={selected.includes(item_id)}
              onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, item_id] : ids.filter((id) => id !== item_id))} />
            {content.security ? "필수 보안 보완 후보" : isAssignment ? "담당자 배분" : content.operation === "create" ? "신규 태스크" : "기존 태스크 수정"}
          </label>
          {content.operation === "create" ? <>
            <p className="whitespace-pre-wrap font-semibold">{content.task.title}</p>
            <p className="whitespace-pre-wrap text-sm">{content.task.description}</p>
            <p className="text-xs">유형: {content.task.task_type} · 영역: {content.task.area} · 공수: {content.task.effort} · 우선순위: {content.task.priority}</p>
            <p className="text-xs">기능 참조: {content.task.feature_ref || "없음"}</p>
          </> : isAssignment ? <>
            <p className="whitespace-pre-wrap font-semibold">{content.task.title}</p>
            <p className="whitespace-pre-wrap text-sm">{content.task.description}</p>
            <p className="text-xs">영역: {content.task.area || "미지정"} · 공수: {content.task.effort || "미지정"}</p>
            <p className="text-sm">담당자: {content.task.assignee || "미할당"} → {content.member.name} ({content.member.role})</p>
            <p className="text-sm">상태: 미할당 → 담당자 수락 대기</p>
            <p className="text-xs whitespace-pre-wrap">제안 이유: {content.reason}</p>
            <p className="text-xs opacity-60">태스크: {content.task.id} · 기준 버전: {content.task.updated_at}</p>
          </> : <>
            <p className="text-xs">대상: {content.update.task_id}</p>
            {Object.entries(content.update.changes).map(([field, value]) => <div key={field}>
              <strong className="text-sm">{LABELS[field] || field}</strong>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="opacity-60">변경 전</span><pre className="whitespace-pre-wrap font-sans">{content.update.before[field] ?? ""}</pre></div>
                <div><span className="opacity-60">변경 후</span><pre className="whitespace-pre-wrap font-sans">{value}</pre></div>
              </div>
            </div>)}
            <p className="text-xs whitespace-pre-wrap">제안 이유: {content.update.reason}</p>
          </>}
        </div>
      ))}
      {missingRequired && <p className="text-sm">필수 보안 보완 후보를 모두 포함해야 저장할 수 있습니다.</p>}
      {expired && <p role="alert">검토 기한이 지났습니다. 태스크 제안을 다시 생성하세요.</p>}
      {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button disabled={busy || expired || needsReview || !selected.length || missingRequired} onClick={() => act("approve")}
          className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-40">선택한 {selected.length}건 {isAssignment ? "승인·배분" : "승인·저장"}</button>
        <button disabled={busy} onClick={() => needsReview ? onDone("검토를 닫았습니다. 최신 목록을 확인하고 제안을 다시 생성하세요.") : expired ? onDone("만료된 제안을 닫았습니다.") : act("cancel")} className="px-3 py-2 border rounded">{needsReview ? "검토 닫기" : "제안 취소"}</button>
      </div>
    </section>
  );
}
