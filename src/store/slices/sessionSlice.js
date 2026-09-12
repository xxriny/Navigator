import { sessionService } from "../../api/services/sessionService";
import { loadSessions, persistSessions, ownsLocalSession, cloneViewportTab, normalizeOutputTabId, extractRunId, spreadResultData, EMPTY_RESULT_FIELDS } from "../storeHelpers";

// 활성 세션이 없을 때 채팅/팝오버 메모를 묶어두는 폴백 세션 키.
// 백엔드 memo_db는 session_id 형식을 강제하지 않으므로 안전한 임의 문자열을 사용.
const CHAT_GLOBAL_SESSION_ID = "chat_global";

const projectRegistrations = new Map();

// Async memo results belong to the account, team and local project that started them.
const sameMemoContext = (a, b) => a.authGeneration === b.authGeneration && a.authToken === b.authToken &&
  a.currentUser?.id === b.currentUser?.id && a.currentUser?.team_id === b.currentUser?.team_id &&
  a.currentSessionId === b.currentSessionId && a.backendPort === b.backendPort;

export const createSessionSlice = (set, get) => ({
  sessions: [],
  currentSessionId: null,
  serverSessionId: null,
  ensureServerSession: async () => {
    const state = get();
    const { currentSessionId: localId, authToken, backendPort, currentUser } = state;
    if (!localId || !authToken || !backendPort) throw new Error("프로젝트·로그인·백엔드 연결이 필요합니다.");
    const key = JSON.stringify([localId, authToken, currentUser?.id, currentUser?.team_id, backendPort, state.serverSessionId]);
    if (projectRegistrations.has(key)) return projectRegistrations.get(key);
    const pending = (async () => {
      const local = state.sessions.find((s) => s.id === localId);
      const existingId = state.serverSessionId || local?.serverSessionId || state.resultData?.project_session_id || state.resultData?.run_id;
      const res = existingId
        ? await sessionService.getProject(backendPort, existingId, authToken)
        : await sessionService.createProject(backendPort, local?.name || "새 프로젝트", currentUser?.team_id, authToken, localId);
      if (res.status !== "ok" || !res.data?.session_id) throw new Error(res.error || "프로젝트 소유권을 확인할 수 없습니다.");
      if (!sameMemoContext(state, get()) || get().serverSessionId !== state.serverSessionId) throw new Error("프로젝트 또는 계정이 변경되었습니다.");
      const id = res.data.session_id;
      set((s) => {
        const sessions = s.sessions.map((item) => item.id === localId ? { ...item, serverSessionId: id } : item);
        persistSessions(sessions, get().currentUser);
        return { sessions, serverSessionId: id };
      });
      return id;
    })();
    projectRegistrations.set(key, pending);
    try { return await pending; } finally { projectRegistrations.delete(key); }
  },
  memoSyncError: "",
  userComments: [],
  chatHistory: [],
  chatInput: "",
  designSnapshots: [],
  designSnapshotCounter: 0,
  // 온보딩: 첫 진입 / 새 프로젝트 시작 직후에 ModeBridge 모달을 띄움
  showOnboardingBridge: true,
  setShowOnboardingBridge: (v) => set({ showOnboardingBridge: !!v }),

  /** Sync 직전에 현재 설계 상태를 스냅샷으로 저장. FIFO로 최근 5개만 유지. */
  pushDesignSnapshot: () => {
    const s = get();
    const counter = s.designSnapshotCounter || 0;
    const entry = {
      version: `v1.${counter}`,
      takenAt: new Date().toISOString(),
      chatHistoryLength: (s.chatHistory || []).length,
      resultData: s.resultData ? structuredClone(s.resultData) : null,
      requirements_rtm: s.requirements_rtm ? structuredClone(s.requirements_rtm) : null,
      components: s.components ? structuredClone(s.components) : null,
      apis: s.apis ? structuredClone(s.apis) : null,
      tables: s.tables ? structuredClone(s.tables) : null,
      tech_stacks: s.tech_stacks ? structuredClone(s.tech_stacks) : null,
      project_structure: s.project_structure ? structuredClone(s.project_structure) : null,
      test_cases: s.test_cases ? structuredClone(s.test_cases) : null,
      recommendations: s.recommendations ? structuredClone(s.recommendations) : null,
      sa_artifacts: s.sa_artifacts ? structuredClone(s.sa_artifacts) : null,
    };
    set((state) => {
      const next = [...(state.designSnapshots || []), entry].slice(-5);
      return { designSnapshots: next, designSnapshotCounter: counter + 1 };
    });
    return entry;
  },

  /** 스냅샷 인덱스로 resultData를 되돌림. chatHistory는 유지하고 rollback 마커를 append.
   *  추가로, fromVersion에서 새로 추가된 메모(reflectedVersion === fromVersion)는 함께 삭제하여
   *  설계서와 메모 라이프사이클의 정합성을 맞춘다. 더 과거 버전(v1.0 등) 메모는 보존. */
  restoreDesignSnapshot: (snapshotIndex) => {
    const s = get();
    const snap = (s.designSnapshots || [])[snapshotIndex];
    if (!snap) {
      get().addNotification?.("스냅샷을 찾을 수 없습니다.", "error");
      return;
    }
    const currentVersion = (() => {
      const lastSync = [...(s.chatHistory || [])].reverse().find(
        (m) => m && m.role === "system_marker" && m.kind === "sync"
      );
      return lastSync?.version || `v1.${(s.designSnapshots || []).length}`;
    })();

    // fromVersion에 새로 반영된 메모만 제거 — 더 과거 버전 메모는 그대로 둔다
    const memosToDrop = (s.userComments || []).filter(
      (m) => m.reflectedVersion === currentVersion
    );

    set({
      resultData: snap.resultData,
      requirements_rtm: snap.requirements_rtm || [],
      components: snap.components || [],
      apis: snap.apis || [],
      tables: snap.tables || [],
      tech_stacks: snap.tech_stacks || [],
      project_structure: snap.project_structure || null,
      test_cases: snap.test_cases || null,
      recommendations: snap.recommendations || [],
      sa_artifacts: snap.sa_artifacts || null,
      chatHistory: [
        ...(s.chatHistory || []),
        {
          role: "system_marker",
          kind: "rollback",
          fromVersion: currentVersion,
          toVersion: snap.version,
          appliedAt: new Date().toISOString(),
        },
      ],
    });

    // 메모 삭제는 set() 이후에 비동기로 처리 — removeComment가 백엔드 DELETE도 호출
    memosToDrop.forEach((m) => {
      if (m && m.id) get().removeComment?.(m.id);
    });

    const droppedNote = memosToDrop.length > 0
      ? ` · 메모 ${memosToDrop.length}건 삭제`
      : "";
    get().addNotification?.(
      `${currentVersion} → ${snap.version} 롤백 완료${droppedNote}`,
      "success",
      3000
    );
  },

  clearDesignSnapshots: () => set({ designSnapshots: [], designSnapshotCounter: 0 }),

  createSession: (initialTitle = null) => {
    const state = get();
    if (!state.currentUser?.id || !state.authToken) return;
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date();
    const session = {
      id,
      name: initialTitle && initialTitle !== "새 프로젝트" ? initialTitle : `세션 ${now.toLocaleDateString("ko")} ${now.toLocaleTimeString("ko", { hour: "2-digit", minute: "2-digit" })}`,
      createdAt: now.getTime(),
      team_id: state.currentUser?.team_id || null,
      owner_user_id: state.currentUser.id,
      visibility: "private",
      projectFolder: state.projectFolder,
      fileTree: state.fileTree,
      openFiles: state.openFiles,
      activeViewportTab: { kind: "output", id: "progress" },
      resultData: null,
      chatHistory: [],
      pipelineStatus: "running",
      pipelineType: state.pipelineType,
      selectedMode: state.selectedMode,
      userComments: [],
      designSnapshots: [],
      designSnapshotCounter: 0,
    };
    set((state) => {
      const sessions = [session, ...state.sessions];
      persistSessions(sessions, get().currentUser);
      return { sessions, currentSessionId: id, serverSessionId: null, userComments: [], memoProposals: [], memoSyncError: "" };
    });
  },

  saveCurrentSession: () => {
    const state = get();
    if (!state.currentSessionId || !state.currentUser?.id) return;
    const updated = state.sessions.map((s) => (
      s.id === state.currentSessionId && ownsLocalSession(s, state.currentUser) ? {
        ...s,
        serverSessionId: state.serverSessionId,
        projectFolder: state.projectFolder,
        fileTree: state.fileTree,
        openFiles: state.openFiles,
        activeViewportTab: cloneViewportTab(state.activeViewportTab),
        resultData: state.resultData,
        chatHistory: state.chatHistory,
        pipelineStatus: state.pipelineStatus,
        pipelineType: state.pipelineType,
        userComments: state.userComments,
        designSnapshots: state.designSnapshots,
        designSnapshotCounter: state.designSnapshotCounter,
      } : s
    ));
    persistSessions(updated, get().currentUser);
    set({ sessions: updated });
  },

  loadSession: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!ownsLocalSession(session, get().currentUser)) return;
    const viewport = cloneViewportTab(session.activeViewportTab);
    if (viewport.kind === "output") viewport.id = normalizeOutputTabId(viewport.id);

    // 즉시 세션 상태 반영 (RAG 복구 전 로컬 데이터 우선) + ModeBridge 닫기
    set({
      currentSessionId: id,
      serverSessionId: session.serverSessionId || session.resultData?.project_session_id || null,
      projectFolder: session.projectFolder || null,
      fileTree: session.fileTree || [],
      openFiles: session.openFiles || [],
      activeViewportTab: viewport,
      ...spreadResultData(session.resultData),
      chatHistory: session.chatHistory || [],
      pipelineStatus: session.resultData ? "done" : "idle",
      memoProposals: [], memoSyncError: "",
      userComments: [], // Reload authorized saved rows; cached proposals are not analysis input.
      designSnapshots: session.designSnapshots || [],
      designSnapshotCounter: session.designSnapshotCounter || (session.designSnapshots?.length || 0),
      showOnboardingBridge: false,
    });

    // RAG 복구는 백그라운드에서 조용히 수행 (로딩 인디케이터 없음)
    get().restoreSessionFromRag(id);
  },

  restoreSessionFromRag: async (id) => {
    const context = get();
    const { sessions, backendPort, _processResult, authToken } = context;
    const session = sessions.find(s => s.id === id);
    const runId = session?.resultData?.run_id || extractRunId(id);
    if (!runId || !backendPort || !ownsLocalSession(session, context.currentUser)) return;
    try {
      const res = await sessionService.restoreSession(backendPort, runId, authToken);
      if (res.status === "ok" && sameMemoContext(context, get()) && get().currentSessionId === id) {
        // 복원된 데이터 반영 시 현재 탭 유지
        const currentTab = get().activeViewportTab;
        _processResult(res.data);
        set({ activeViewportTab: currentTab });
      }
    } catch (e) {
      // 조용히 처리
    }
  },

  syncMemos: async () => {
    const context = get();
    const { backendPort, currentSessionId, authToken } = context;
    if (!currentSessionId || !authToken || !backendPort) { set({ userComments: [], memoSyncError: "프로젝트·로그인·백엔드 연결을 확인하세요." }); return false; }
    try {
      const serverId = await get().ensureServerSession();
      const data = await sessionService.getMemos(backendPort, serverId, authToken);
      if (data.status !== "ok") throw new Error(data.error || "메모 조회 실패");
      if (!sameMemoContext(context, get()) || get().serverSessionId !== serverId) return false;
      set({ memoSyncError: "", userComments: (data.memos || []).map((m) => ({
        id: m.id, text: m.text, selectedText: m.metadata?.selected_text || "",
        section: m.metadata?.section || "Global", detail: m.metadata?.detail || "",
        applied: !!m.metadata?.applied, appliedAt: m.metadata?.applied_at || null,
        reflectedVersion: m.metadata?.reflected_version || null, createdAt: Date.now(), persisted: true,
      })) });
      return true;
    } catch (e) {
      if (!sameMemoContext(context, get())) return false;
      set({ userComments: [], memoSyncError: `메모 목록 확인 실패: ${e.message}` });
      get().addDebugLog({ level: "error", message: "메모 동기화 실패", rawData: { error: e.message } });
      return false;
    }
  },

  addComment: async (comment, opts = {}) => {
    const context = get();
    const { backendPort, currentSessionId, authToken } = context;
    if (!backendPort || !currentSessionId || !authToken) {
      get().addNotification("프로젝트·로그인·백엔드 연결을 확인하세요. 메모는 저장되지 않았습니다.", "warning", 3000);
      return false;
    }
    try {
      const serverId = await get().ensureServerSession();
      const res = await sessionService.addMemo(backendPort, {
        session_id: serverId, text: comment.text, selected_text: comment.selectedText || "",
        section: comment.section || "Global", detail: comment.detail || "",
      }, authToken);
      if (res.status !== "ok" || !res.memo_id) throw new Error(res.error || "저장 결과를 확인할 수 없습니다.");
      if (!sameMemoContext(context, get())) return false;
      {
        set((state) => ({ userComments: [...state.userComments.filter((c) => c.id !== res.memo_id),
          { ...comment, id: res.memo_id, createdAt: Date.now(), persisted: true }] }));
      }
      if (!opts.silent) get().addNotification("메모가 저장되었습니다.", "success");
      return true;
    } catch (e) {
      if (!sameMemoContext(context, get())) return false;
      get().addNotification(`메모 저장 실패: ${e.message}`, "error");
      return false;
    }
  },

  removeComment: async (id) => {
    const context = get();
    const { backendPort, currentSessionId, authToken } = context;
    if (!id || !backendPort || !authToken) return false;
    try {
      const res = await sessionService.removeMemo(backendPort, id, authToken);
      if (res.status !== "ok") throw new Error(res.error || "메모 삭제 실패");
      if (!sameMemoContext(context, get())) return false;
      {
        set((state) => ({ userComments: state.userComments.filter((c) => c.id !== id) }));
      }
      get().addNotification("메모가 삭제되었습니다.", "success");
      return true;
    } catch (e) {
      if (!sameMemoContext(context, get())) return false;
      get().addNotification(`메모 삭제 실패: ${e.message}`, "error");
      return false;
    }
  },

  /**
   * 메모 ID 목록을 백엔드에 'applied' 표시 요청 + 로컬 userComments에도 반영.
   * "지적사항 반영 설계 업데이트" 흐름의 마지막 단계에서 _processResult가 호출.
   * 실패해도 사용자 흐름을 막지 않는다 (백엔드 일시 장애 등).
   */
  markMemosApplied: async (memoIds, opts = {}) => {
    const { backendPort, currentSessionId, authToken } = get();
    if (!Array.isArray(memoIds) || memoIds.length === 0) return;
    const reflectedVersion = opts.reflectedVersion || null;
    if (!backendPort || !authToken) {
      console.warn("[markMemosApplied] backendPort 없어 백엔드 갱신 스킵");
      return;
    }
    try {
      const res = await sessionService.applyMemos(backendPort, memoIds, reflectedVersion, authToken);
      if (res?.status === "ok" && get().currentSessionId === currentSessionId && get().authToken === authToken) {
        const ts = new Date().toISOString();
        set((s) => ({
          userComments: (s.userComments || []).map((c) =>
            memoIds.includes(c.id)
              ? {
                  ...c,
                  applied: true,
                  appliedAt: ts,
                  ...(reflectedVersion ? { reflectedVersion } : {}),
                }
              : c
          ),
        }));
        return true;
      } else {
        throw new Error(res?.error || "메모 보관 결과를 확인할 수 없습니다.");
      }
    } catch (e) {
      get().addNotification(`메모 보관 실패: ${e.message}`, "error");
      get().addDebugLog?.({
        level: "error",
        message: "메모 applied 표시 실패",
        rawData: { error: e?.message, ids: memoIds },
      });
    }
    return false;
  },

  setChatInput: (text) => set({ chatInput: text }),
  addChatMessage: (role, content) =>
    set((s) => ({ chatHistory: [...s.chatHistory, { role, content }] })),
  clearChat: () => set({ chatHistory: [], chatInput: "" }),

  /** 모든 작업 상태를 초기화하여 ModeBridge → 빈 프롬프트 흐름으로 돌아간다.
   *  현재 세션은 sessions 배열에 그대로 남아 라이브러리에서 다시 열 수 있음. */
  startNewProject: () => {
    set({
      currentSessionId: null,
      serverSessionId: null,
      chatHistory: [],
      chatInput: "",
      userComments: [],
      designSnapshots: [],
      designSnapshotCounter: 0,
      showOnboardingBridge: true,
      pipelineStatus: "idle",
      pipelineError: null,
      pipelineNodes: {},
      thinkingLog: [],
      pipelineType: "analysis",
      agileImpactResult: null,
      lastIdeaReady: false,
      lastIdeaSummary: "",
      lastSuggestedMode: null,
      lastFollowups: [],
      _syncInFlight: false,
      _syncMemoIdsForApply: [],
      _syncTargetVersion: null,
      activeViewportTab: { kind: "output", id: "home" },
      lastOutputTab: "home",
      ...EMPTY_RESULT_FIELDS,
    });
  },

  updateSessionName: (id, name) => {
    set((state) => {
      const updated = state.sessions.map((s) => (s.id === id && ownsLocalSession(s, state.currentUser) ? { ...s, name } : s));
      persistSessions(updated, get().currentUser);
      return { sessions: updated };
    });
  },
});
