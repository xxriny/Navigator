import { ownsLocalSession } from "../store/storeHelpers";
import React, { useState } from "react";
import useAppStore from "../store/useAppStore";
import { Clock3, X as XIcon, Edit3, RefreshCw } from "lucide-react";

export default function SessionPanel() {
  const { sessions, currentSessionId, loadSession, deleteSession, updateSessionName, isDarkMode } = useAppStore();
  const currentUser = useAppStore((s) => s.currentUser);
  const teamId = currentUser?.team_id || null;
  const visibleSessions = sessions.filter(s => ownsLocalSession(s, currentUser));
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const handleStartEdit = (e, session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditValue(session.name);
  };

  const handleSaveEdit = (sessionId) => {
    if (editValue.trim()) {
      updateSessionName(sessionId, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <div className={`h-full min-h-0 flex flex-col bg-transparent transition-colors duration-300`}>
      <div className={`flex items-center gap-2 px-3 py-3 border-b border-[var(--border)] bg-transparent`}>
        <Clock3 size={14} className="text-blue-400" />
        <span className={`text-sm font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>라이브러리</span>
        <span className="ml-auto text-[12px] text-slate-500">{visibleSessions.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {visibleSessions.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-slate-600 italic">
            저장된 세션이 없습니다
          </div>
        ) : (
          visibleSessions.map((session) => {
            const isActive = currentSessionId === session.id;
            const isEditing = editingId === session.id;

            return (
              <div
                key={session.id}
                onClick={() => !isEditing && loadSession(session.id)}
                onDoubleClick={(e) => handleStartEdit(e, session)}
                className={`group rounded-xl p-3 border transition-all ${
                  isActive
                    ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 shadow-[0_0_15px_rgba(56,189,248,0.05)]"
                    : "border-transparent hover:bg-white/5 hover:border-white/10"
                } ${isEditing ? "cursor-default" : "cursor-pointer"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => handleSaveEdit(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(session.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className={`w-full bg-white/10 border border-blue-500 rounded px-2 py-1 text-sm outline-none ${isDarkMode ? "text-white" : "text-black"}`}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-bold truncate ${isActive ? "text-[var(--accent)]" : (isDarkMode ? "text-slate-200" : "text-slate-800")}`}>
                          {session.name}
                        </p>
                        <Edit3 size={10} className="opacity-0 group-hover:opacity-40 text-blue-400" />
                      </div>
                    )}
                    <p className={`mt-1 text-[11px] font-medium ${isDarkMode ? "text-slate-500" : "text-slate-500/80"}`}>
                      {new Date(session.createdAt).toLocaleString("ko", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {!isEditing && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          useAppStore.getState().restoreSessionFromRag(session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-blue-500/10 hover:text-blue-400 transition-all"
                        title="RAG에서 데이터 동기화"
                      >
                        <RefreshCw size={12} className={isActive ? "animate-spin-slow" : ""} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-all"
                        title="세션 삭제"
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
