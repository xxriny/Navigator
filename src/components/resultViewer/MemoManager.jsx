import React, { useState, useEffect, useMemo } from "react";
import MemoProposalReview from "./MemoProposalReview";
import useAppStore from "../../store/useAppStore";
import {
  StickyNote, Trash2, Search, Filter, Archive, ListChecks, X,
  ChevronDown, FileText, Plus, Rocket,
} from "lucide-react";

const SECTION_MAP = {
  overview: "분석 개요",
  rtm: "요구사항(RTM)",
  stack: "기술 스택",
  sa_overview: "아키텍처 분석",
  sa_components: "컴포넌트 설계",
  sa_api: "API 설계",
  sa_db: "데이터베이스 설계",
  memo: "메모 관리",
  "Idea Chat": "AI 채팅",
  "Chat Request": "AI 채팅",
};

export default function MemoManager() {
  const memoProposals = useAppStore((s) => s.memoProposals);
  const dismissMemoProposal = useAppStore((s) => s.dismissMemoProposal);
  const authToken = useAppStore((s) => s.authToken);
  const backendPort = useAppStore((s) => s.backendPort);
  const memoSyncError = useAppStore((s) => s.memoSyncError);
  const currentUser = useAppStore((s) => s.currentUser);
  const isDarkMode = useAppStore((s) => s.isDarkMode);
  const userComments = useAppStore((s) => s.userComments);
  const addComment = useAppStore((s) => s.addComment);
  const removeComment = useAppStore((s) => s.removeComment);
  const syncMemos = useAppStore((s) => s.syncMemos);
  const userRole = useAppStore((s) => s.userRole);
  const serverSessionId = useAppStore((s) => s.serverSessionId);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const canEdit = !userRole || userRole === "pm" || userRole === "engineer";

  const [searchTerm, setSearchTerm] = useState("");
  const [filterSection, setFilterSection] = useState("All");
  const [viewMode, setViewMode] = useState("active"); // "active" | "applied"
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // detail 펼침 토글
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMemoText, setNewMemoText] = useState("");
  const [newMemoSection, setNewMemoSection] = useState("Global");

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => { syncMemos(); }, [currentSessionId, serverSessionId, authToken, currentUser?.id, currentUser?.team_id, backendPort, syncMemos]);

  const visibleByMode = useMemo(
    () => userComments.filter((m) => (viewMode === "applied" ? !!m.applied : !m.applied)),
    [userComments, viewMode]
  );

  const sections = useMemo(
    () => ["All", ...new Set(visibleByMode.map((c) => c.section).filter(Boolean))],
    [visibleByMode]
  );

  const filteredMemos = useMemo(() => {
    return visibleByMode.filter((memo) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        memo.text.toLowerCase().includes(term) ||
        memo.selectedText?.toLowerCase().includes(term);
      const matchesFilter = filterSection === "All" || memo.section === filterSection;
      return matchesSearch && matchesFilter;
    });
  }, [visibleByMode, searchTerm, filterSection]);

  const deleteAllFiltered = () => {
    if (filteredMemos.length === 0) return;
    const ok = window.confirm(
      `현재 보이는 메모 ${filteredMemos.length}건을 모두 삭제할까요? 되돌릴 수 없습니다.`
    );
    if (!ok) return;
    filteredMemos.forEach((m) => removeComment(m.id));
  };

  const handleAddMemo = async () => {
    if (!newMemoText.trim()) return;
    const saved = await addComment({ text: newMemoText.trim(), section: newMemoSection, selectedText: "", detail: "" });
    if (!saved) return;
    setNewMemoText("");
    setShowAddForm(false);
  };

  return (
    <div className={`h-full flex flex-col p-6 space-y-6 ${isDarkMode ? "text-slate-300" : "text-slate-800"}`}>
      {memoSyncError && <p role="alert">{memoSyncError} <button onClick={() => syncMemos()}>목록 다시 확인</button></p>}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? "text-white" : "text-slate-900"}`}>
            전체 메모 관리
          </h2>
          {canEdit && (
            <button
              onClick={() => setShowAddForm((v) => !v)}
              title="메모 직접 추가"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                showAddForm
                  ? isDarkMode ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-600"
                  : isDarkMode ? "bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
              }`}
            >
              <Plus size={13} />
              메모 추가
            </button>
          )}
        </div>
        <p className="text-sm opacity-60">
          프로젝트 수행 중 기록된 모든 지적사항과 메모를 중앙에서 관리합니다.
        </p>

        {(memoProposals || []).filter((p) => p.session_id === serverSessionId && p.actor_id === currentUser?.id).map((p) => (
          <MemoProposalReview key={p.proposal_id} proposal={p} onDismiss={dismissMemoProposal} />
        ))}

        {/* 단일 트리거 안내 — 메모는 메인 화면의 🚀 버튼이 함께 반영함 */}
        <div
          className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
            isDarkMode
              ? "bg-blue-500/[0.06] border-blue-500/15 text-slate-300"
              : "bg-blue-50/60 border-blue-100 text-slate-700"
          }`}
        >
          <Rocket size={16} className={isDarkMode ? "text-emerald-300 shrink-0 mt-0.5" : "text-emerald-600 shrink-0 mt-0.5"} />
          <p className="text-[12px] leading-relaxed">
            메모는 메인 화면 하단의{" "}
            <strong className={isDarkMode ? "text-white" : "text-slate-900"}>🚀 설계서 업데이트</strong> 버튼을
            누르면 그 시점의 활성 메모 전부가 대화 내역과 함께 자동 반영됩니다. 반영된 메모는 "이전 메모"로
            이동하며, 어느 버전(v1.x)에 반영되었는지 배지로 확인할 수 있습니다.
          </p>
        </div>

        {/* ── 메모 직접 입력 폼 ─────────────────── */}
        {showAddForm && (
          <div className={`p-4 rounded-xl border space-y-3 animate-fade-in ${isDarkMode ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
            <textarea
              value={newMemoText}
              onChange={(e) => setNewMemoText(e.target.value)}
              placeholder="메모 내용을 입력하세요..."
              rows={3}
              className={`w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none transition-colors ${
                isDarkMode
                  ? "bg-black/20 border-white/10 text-white placeholder:text-slate-500 focus:border-blue-500/60"
                  : "bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-400"
              }`}
            />
            <div className="flex items-center gap-2">
              <select
                value={newMemoSection}
                onChange={(e) => setNewMemoSection(e.target.value)}
                style={{ colorScheme: "light" }}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border outline-none ${
                  isDarkMode ? "bg-slate-800 border-white/10 text-slate-100" : "bg-white border-slate-200 text-slate-800"
                }`}
              >
                <option value="Global">Global</option>
                {Object.entries(SECTION_MAP).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button
                onClick={handleAddMemo}
                disabled={!newMemoText.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
              >
                저장
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewMemoText(""); }}
                className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-200 text-slate-500"}`}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 뷰 모드 토글 ─────────────────────── */}
      <div className="flex items-center gap-2">
        <ViewModeButton
          active={viewMode === "active"}
          onClick={() => setViewMode("active")}
          isDarkMode={isDarkMode}
          Icon={ListChecks}
          label={`활성 메모 (${userComments.filter((m) => !m.applied).length})`}
        />
        <ViewModeButton
          active={viewMode === "applied"}
          onClick={() => setViewMode("applied")}
          isDarkMode={isDarkMode}
          Icon={Archive}
          label={`이전 메모 (${userComments.filter((m) => !!m.applied).length})`}
        />
      </div>

      {/* ── 검색 / 섹션 필터 ──────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className={`flex-1 min-w-[200px] flex items-center gap-2 px-3 py-2 rounded-xl border ${isDarkMode ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
          <Search size={16} className="text-slate-500" />
          <input
            type="text"
            placeholder="메모 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent border-none outline-none text-sm w-full"
          />
        </div>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isDarkMode ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
          <Filter size={16} className="text-slate-500" />
          <select
            value={filterSection}
            onChange={(e) => setFilterSection(e.target.value)}
            className="bg-transparent border-none outline-none text-sm cursor-pointer"
          >
            {sections.map((s) => (
              <option key={s} value={s}>{SECTION_MAP[s] || s}</option>
            ))}
          </select>
        </div>

        {filteredMemos.length > 0 && canEdit && (
          <button
            onClick={deleteAllFiltered}
            title="현재 목록에 보이는 메모를 모두 삭제"
            className={`ml-auto px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors ${
              isDarkMode
                ? "bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30"
                : "bg-red-50 hover:bg-red-100 text-red-700 border border-red-200"
            }`}
          >
            <Trash2 size={12} />
            전체 삭제
          </button>
        )}
      </div>

      {/* ── 메모 리스트 ──────────────────── */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
        {filteredMemos.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center opacity-20 border-2 border-dashed border-white/10 rounded-3xl">
            <StickyNote size={48} className="mb-4" />
            <p>
              {viewMode === "applied"
                ? "이전에 반영된 메모가 없습니다."
                : "검색 결과가 없거나 작성된 메모가 없습니다."}
            </p>
          </div>
        ) : (
          filteredMemos.map((memo) => {
            const isApplied = !!memo.applied;
            const hasDetail = !!(memo.detail && memo.detail.trim());
            const isExpanded = expandedIds.has(memo.id);
            return (
              <div
                key={memo.id}
                className={`group p-5 rounded-2xl border transition-all ${
                  isApplied
                    ? `opacity-70 ${isDarkMode ? "bg-white/[0.02] border-white/5" : "bg-slate-50 border-slate-200"}`
                    : `hover:scale-[1.005] ${isDarkMode ? "bg-white/5 border-white/5 hover:border-white/20" : "bg-white border-slate-200 shadow-sm hover:shadow-md"}`
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* 좌측 마커 — applied/active 시각 구분 */}
                  <div className="mt-1 shrink-0">
                    {isApplied ? (
                      <Archive size={18} className="text-slate-500" />
                    ) : (
                      <div className={`w-2 h-2 rounded-full mt-1.5 ${isDarkMode ? "bg-blue-400" : "bg-blue-500"}`} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "bg-blue-500/20 text-blue-300" : "bg-blue-50 text-blue-600"}`}>
                        {SECTION_MAP[memo.section] || memo.section}
                      </span>
                      {isApplied && memo.reflectedVersion && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}
                          title={memo.appliedAt || ""}
                        >
                          {memo.reflectedVersion} 반영 완료
                        </span>
                      )}
                      {isApplied && !memo.reflectedVersion && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}
                          title={memo.appliedAt || ""}
                        >
                          반영됨
                        </span>
                      )}
                      {hasDetail && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${isDarkMode ? "bg-purple-500/15 text-purple-300" : "bg-purple-50 text-purple-700"}`}
                          title="상세 내용 있음"
                        >
                          <FileText size={10} /> 상세
                        </span>
                      )}
                    </div>

                    {/* 제목 + 토글 */}
                    <button
                      type="button"
                      onClick={() => hasDetail && toggleExpand(memo.id)}
                      disabled={!hasDetail}
                      className={`text-left w-full flex items-start gap-2 mb-2 ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
                    >
                      {hasDetail && (
                        <span className={`mt-1 shrink-0 transition-transform ${isExpanded ? "rotate-0" : "-rotate-90"} ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                          <ChevronDown size={16} />
                        </span>
                      )}
                      <h3 className={`text-base font-bold flex-1 min-w-0 ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
                        {memo.text}
                      </h3>
                    </button>

                    {memo.selectedText && (
                      <div className={`p-3 rounded-xl text-sm italic mb-1 border-l-4 ${isDarkMode ? "bg-black/20 border-blue-500/40 text-slate-400" : "bg-slate-50 border-blue-200 text-slate-500"}`}>
                        "{memo.selectedText}"
                      </div>
                    )}

                    {/* 상세 내용 (토글 펼침 시) */}
                    {hasDetail && isExpanded && (
                      <div
                        className={`mt-2 p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap border-l-4 animate-fade-in ${isDarkMode ? "bg-purple-500/[0.06] border-purple-400/40 text-slate-300" : "bg-purple-50/50 border-purple-300 text-slate-700"}`}
                      >
                        <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isDarkMode ? "text-purple-300" : "text-purple-700"}`}>
                          상세 수정 사항
                        </div>
                        {memo.detail}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => removeComment(memo.id)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-500 transition-colors"
                      title="삭제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── 보조 컴포넌트 ───────────────────────────

function ViewModeButton({ active, onClick, Icon, label, isDarkMode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
        active
          ? isDarkMode
            ? "bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/40"
            : "bg-blue-100 text-blue-700 border border-blue-200"
          : isDarkMode
          ? "bg-white/5 text-slate-400 hover:text-slate-200 border border-white/5 hover:border-white/10"
          : "bg-slate-50 text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-100"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}
