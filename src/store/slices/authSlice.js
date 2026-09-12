/**
 * authSlice — 인증 상태 관리
 * 로그인/로그아웃, 현재 사용자, 역할/플랜 정보
 */

import { EMPTY_RESULT_FIELDS, loadSessions } from "../storeHelpers";
import { serverRequest, SERVER_URL } from "../../api/serverClient";

const AUTH_KEY = "navigator_auth";

function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return { token: null, user: null };
    return JSON.parse(raw);
  } catch {
    return { token: null, user: null };
  }
}

function saveAuth(token, user) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
}

function clearStoredAuth() {
  localStorage.removeItem(AUTH_KEY);
}

const stored = loadStoredAuth();
const workspaceKey = (user, teamId = user?.team_id) => JSON.stringify([user?.id, teamId || null]);
const emptyWorkspace = () => ({
  ...EMPTY_RESULT_FIELDS, resultData: null, sessions: [], currentSessionId: null, serverSessionId: null,
  chatHistory: [], chatInput: "", userComments: [], memoProposals: [], memoSyncError: "",
  designSnapshots: [], designSnapshotCounter: 0, snapshots: [], activeSnapshot: null, localResults: [],
  pipelineStatus: "idle", pipelineError: null, pipelineNodes: {}, thinkingLog: [], agileImpactResult: null,
  lastIdeaReady: false, lastIdeaSummary: "", lastSuggestedMode: null, lastFollowups: [],
  _syncInFlight: false, _syncMemoIdsForApply: [], _syncTargetVersion: null, analysisOwnerTeamId: null,
  activeViewportTab: {kind: "output", id: "home"}, activeIconPanel: null, showOnboardingBridge: true,
  projectFolder: null, fileTree: [], openFiles: [], publishError: null,
  devTrackingResult: null, devTrackingAnalyses: [], devTrackingForm: null,
  devTrackingRunning: false, devTrackingRunError: "", debugLogs: [],
});

export const createAuthSlice = (set, get) => ({
  // ── 상태 ────────────────────────────────────────────────
  authToken: stored.token,
  currentUser: stored.user,
  userRole: stored.user?.role ?? null,
  userPlan: stored.user?.plan ?? "free",
  authChecked: false,
  authStatus: stored.token ? "checking" : "unauthenticated",
  authGeneration: 0,
  githubDeviceAttempt: null,
  hasUsers: null,
  myTeams: [],           // 다중 팀 목록
  teamWorkspaces: {},    // { [teamId]: parked workspace snapshot }
  analysisOwnerTeamId: null, // 현재 실행 중인 분석을 시작한 팀

  // ── 액션 ────────────────────────────────────────────────
  setAuth: (token, user) => {
    const previous = get();
    const accountChanged = previous.currentUser?.id !== user?.id;
    const boundaryChanged = accountChanged || previous.currentUser?.team_id !== user?.team_id;
    const changed = boundaryChanged || previous.authToken !== token;
    if (boundaryChanged) previous.saveCurrentSession?.();
    saveAuth(token, user);
    set({
      ...(boundaryChanged ? emptyWorkspace() : {}),
      ...(boundaryChanged ? {sessions: loadSessions(user)} : {}),
      ...(accountChanged ? {teamWorkspaces: {}, myTeams: [], githubToken: "", githubOwner: "", githubRepo: "", githubBranch: "main"} : {}),
      ...(changed ? {githubDeviceAttempt: null, userComments: [], memoProposals: [], memoSyncError: ""} : {}),
      authGeneration: (previous.authGeneration || 0) + (changed ? 1 : 0),
      authToken: token, currentUser: user, authStatus: "authenticated",
      userRole: user?.role ?? null, userPlan: user?.plan ?? "free",
    });
    if (boundaryChanged) get().loadGithubSettings?.(user);
    if (changed) { get().resetPipelineRuntime?.(); get().resetWebSocket?.(); }
  },

  clearAuth: () => {
    const previous = get();
    previous.saveCurrentSession?.();
    clearStoredAuth();
    set({ ...emptyWorkspace(), githubDeviceAttempt: null, authToken: null, currentUser: null, userRole: null, userPlan: "free",
      authStatus: "unauthenticated", authGeneration: (previous.authGeneration || 0) + 1,
      teamWorkspaces: {}, myTeams: [], githubToken: "", githubOwner: "", githubRepo: "", githubBranch: "main" });
    get().resetPipelineRuntime?.(); get().resetWebSocket?.();
  },

  isAuthenticated: () => !!get().authToken && get().authStatus === "authenticated",

  setAuthChecked: (checked) => set({ authChecked: checked }),
  setHasUsers: (v) => set({ hasUsers: v }),

  // ── API 헬퍼 ────────────────────────────────────────────
  getAuthHeader: () => {
    const token = get().authToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  /** 앱 시작 시 서버에서 사용자 존재 여부 확인 */
  checkAuthStatus: async () => {
    const { authToken, authGeneration } = get();
    const unchanged = () => get().authToken === authToken && get().authGeneration === authGeneration;
    try {
      const [statusData, me] = await Promise.all([
        serverRequest("/auth/status"),
        authToken ? serverRequest("/auth/me", {headers: {Authorization: `Bearer ${authToken}`}}) : null,
      ]);
      if (!unchanged()) return;
      set({hasUsers: statusData.has_users, authChecked: true});
      if (me) {
        get().setAuth(authToken, me);
        // A restored auth cache does not imply that the account's session cache was loaded.
        if (!get().currentSessionId) { set({sessions: loadSessions(me)}); get().loadGithubSettings?.(me); }
      } else set({authStatus: "unauthenticated"});
    } catch (error) {
      if (unchanged()) set({authChecked: true, authStatus: error.status === 401 ? "unauthenticated" : "unavailable"});
      else if (!get().authToken) set({authChecked: true});
    }
  },

  /** 로그인 */
  login: async (email, password) => {
    const generation = get().authGeneration;
    const data = await serverRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (get().authGeneration !== generation) throw new Error("로그인 상태가 변경되었습니다. 다시 시도해주세요.");
    get().setAuth(data.access_token, data.user);
    return data.user;
  },

  /** 회원가입 */
  register: async (payload) => {
    const generation = get().authGeneration;
    const data = await serverRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (get().authGeneration !== generation) throw new Error("로그인 상태가 변경되었습니다. 다시 시도해주세요.");
    get().setAuth(data.access_token, data.user);
    set({ hasUsers: true });
    return data.user;
  },

  /** 로그아웃 */
  logout: () => {
    get().clearAuth();
  },

  /** 팀 생성 (로그인 후 팀이 없는 사용자) */
  createTeam: async (teamName) => {
    const context = get();
    const headers = context.getAuthHeader();
    await serverRequest("/auth/teams", {method: "POST", headers, body: JSON.stringify({name: teamName})});
    if (get().authGeneration !== context.authGeneration) return;
    const me = await serverRequest("/auth/me", {headers});
    if (get().authGeneration !== context.authGeneration) return;
    get()._parkCurrentWorkspace();
    get().setAuth(context.authToken, me);
    get()._restoreWorkspace(me.team_id);
    await get().loadMyTeams();
    return me;
  },

  /** 내 팀 목록 불러오기 */
  loadMyTeams: async () => {
    const { isAuthenticated, getAuthHeader } = get();
    if (!isAuthenticated()) return;
    try {
      const generation = get().authGeneration;
      const data = await serverRequest("/auth/users/me/teams", { headers: getAuthHeader() });
      if (get().authGeneration === generation) set({ myTeams: data.teams || [] });
    } catch (e) {
      console.error("Failed to load my teams", e);
    }
  },

  // 파킹/복원 대상 필드 목록
  _workspaceFields: [
    "pipelineStatus", "pipelineError", "pipelineNodes", "thinkingLog",
    "agileImpactResult",
    "currentSessionId", "serverSessionId", "userComments", "chatHistory", "chatInput",
    "activeViewportTab", "activeIconPanel",
    "snapshots", "activeSnapshot", "localResults", "publishError",
    ...Object.keys(EMPTY_RESULT_FIELDS),
  ],

  /** 현재 팀 워크스페이스 상태를 teamWorkspaces에 파킹 */
  _parkCurrentWorkspace: () => {
    const s = get();
    const teamId = s.currentUser?.team_id;
    if (!teamId) return;
    s.saveCurrentSession?.();
    const snapshot = {ownerUserId: s.currentUser.id};
    for (const f of s._workspaceFields) snapshot[f] = s[f];
    snapshot._sessions = (s.sessions || []).filter(sess =>
      sess.owner_user_id === s.currentUser.id && (sess.team_id || null) === (teamId || null));
    set(prev => ({teamWorkspaces: {...prev.teamWorkspaces, [workspaceKey(s.currentUser)]: snapshot}}));
  },

  _restoreWorkspace: (teamId) => {
    const user = get().currentUser;
    if (!user?.id || (user.team_id || null) !== (teamId || null)) return;
    const parked = get().teamWorkspaces[workspaceKey(user, teamId)];
    const workspace = parked?.ownerUserId === user.id ? parked : emptyWorkspace();
    const {_sessions, ownerUserId, ...rest} = workspace;
    set({...rest, serverSessionId: rest.serverSessionId || null,
      userComments: [], memoProposals: [], memoSyncError: "",
      sessions: _sessions || loadSessions(user)});
  },

  /** 원격 팀 전환 성공 및 요청 계정 확인 후 워크스페이스 전환 */
  switchTeam: async (teamId) => {
    const context = get();
    if (context.currentUser?.team_id === teamId) return;
    const data = await serverRequest("/auth/users/me/teams/switch", {
      method: "POST", headers: context.getAuthHeader(), body: JSON.stringify({team_id: teamId}),
    });
    if (get().authGeneration !== context.authGeneration) return;
    get()._parkCurrentWorkspace();
    get().setAuth(context.authToken, data.user);
    get()._restoreWorkspace(data.user.team_id);
    await get().loadMyTeams();
    return data.user;
  },

  /** GitHub OAuth Web Flow: 인증 URL + session_id 가져오기 */
  getGithubOAuthUrl: async () => {
    const data = await serverRequest("/auth/github/oauth-url");
    return { url: data.url, sessionId: data.session_id };
  },

  /** GitHub OAuth Web Flow: 폴링으로 결과 확인 */
  pollGithubOAuthResult: async (sessionId) => {
    try {
      const data = await serverRequest(`/auth/github/callback-poll/${sessionId}`);
      if (data.status === "done") {
        get().setAuth(data.access_token, data.user);
        set({ hasUsers: true });
      }
      return data;
    } catch {
      return { status: "error", error: "세션 만료" };
    }
  },

  /** Device Flow uses the Cloud server's public OAuth client configuration. */
  cancelGithubDeviceFlow: () => set({githubDeviceAttempt: null}),

  startGithubDeviceFlow: async () => {
    const context = get();
    const attempt = {generation: context.authGeneration, token: context.authToken,
      userId: context.currentUser?.id, inFlight: false};
    set({githubDeviceAttempt: attempt});
    try {
      const data = await serverRequest("/auth/github/device/start", {method: "POST"});
      if (get().githubDeviceAttempt !== attempt || get().authGeneration !== attempt.generation)
        throw new Error("인증 요청이 취소되었습니다.");
      if (typeof data.device_code !== "string" || !data.device_code ||
          typeof data.user_code !== "string" || !data.user_code ||
          data.verification_uri !== "https://github.com/login/device" ||
          !Number.isInteger(data.interval) || data.interval <= 0 ||
          !Number.isInteger(data.expires_in) || data.expires_in <= 0)
        throw new Error("GitHub 인증 응답을 확인할 수 없습니다.");
      Object.assign(attempt, {code: data.device_code, interval: data.interval,
        expiresAt: Date.now() + data.expires_in * 1000, nextPollAt: Date.now() + data.interval * 1000});
      return data;
    } catch (error) {
      if (get().githubDeviceAttempt === attempt) set({githubDeviceAttempt: null});
      throw error;
    }
  },

  pollGithubDeviceFlow: async (device_code) => {
    const attempt = get().githubDeviceAttempt;
    const current = () => attempt && get().githubDeviceAttempt === attempt &&
      get().authGeneration === attempt.generation && get().authToken === attempt.token;
    if (!current() || attempt.code !== device_code) return {status: "error", error: "인증 요청이 취소되었습니다."};
    if (Date.now() >= attempt.expiresAt) {
      set({githubDeviceAttempt: null});
      return {status: "error", error: "expired_token"};
    }
    if (attempt.inFlight || Date.now() < attempt.nextPollAt)
      return {status: "pending", interval: attempt.interval};
    attempt.inFlight = true;
    try {
      const data = await serverRequest("/auth/github/device/poll", {
        method: "POST", headers: attempt.token ? {Authorization: `Bearer ${attempt.token}`} : {},
        body: JSON.stringify({device_code}),
      });
      if (!current()) return {status: "error", error: "인증 요청이 취소되었습니다."};
      if (Date.now() >= attempt.expiresAt) {
        set({githubDeviceAttempt: null});
        return {status: "error", error: "expired_token"};
      }
      if (typeof data.access_token === "string" && data.access_token && data.user?.id) {
        if (attempt.token && data.user.id !== attempt.userId)
          throw new Error("GitHub 연결 대상 계정이 일치하지 않습니다.");
        get().setAuth(data.access_token, data.user);
        set({hasUsers: true, githubDeviceAttempt: null});
        return {...data, status: "ok"};
      }
      if (data.error === "authorization_pending" || data.error === "slow_down") {
        if (data.error === "slow_down") attempt.interval = Math.max(attempt.interval + 5,
          Number.isInteger(data.interval) ? data.interval : 0);
        attempt.nextPollAt = Date.now() + attempt.interval * 1000;
        return {status: "pending", error: data.error, interval: attempt.interval};
      }
      set({githubDeviceAttempt: null});
      return {status: "error", error: data.error || "GitHub 인증 응답을 확인할 수 없습니다."};
    } catch (error) {
      if (current()) set({githubDeviceAttempt: null});
      return {status: "error", error: error.message};
    } finally { attempt.inFlight = false; }
  },

  disconnectGithub: async () => {
    try {
      await serverRequest("/auth/github/disconnect", {
        method: "POST",
        headers: get().getAuthHeader(),
      });
    } catch (_) {}
    set((s) => ({
      currentUser: s.currentUser ? { ...s.currentUser, github_id: null, github_login: null } : null,
      githubToken: "",
    }));
  },
});
