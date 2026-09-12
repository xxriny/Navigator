/**
 * SettingsPanel — 설정 패널 (분리된 독립 컴포넌트)
 */
import React, { useState, useEffect, useRef } from "react";
import useAppStore from "../store/useAppStore";
import { serverRequest } from "../api/serverClient";
import { Github, Check, X, Loader2, ChevronDown } from "lucide-react";

export default function SettingsPanel({ onShowPricing }) {
  const {
    isDarkMode,
    backendPort,
    startGithubDeviceFlow,
    pollGithubDeviceFlow,
    disconnectGithub,
    setGithubSettings,
    setGithubBranch,
    githubToken,
    githubOwner,
    githubRepo,
    githubBranch,
  } = useAppStore();
  const authToken = useAppStore((s) => s.authToken);
  const currentUser = useAppStore((s) => s.currentUser);
  const isGithubConnected = !!currentUser?.github_id;

  const [oauthConfig, setOauthConfig] = useState({ client_id: "", client_secret: "", github_repo: "" });

  // 레포 피커 state
  const [repoList, setRepoList] = useState([]);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [repoScopeError, setRepoScopeError] = useState(false);

  // 브랜치 피커 state
  const [branchList, setBranchList] = useState([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthStatus, setOauthStatus] = useState(null);
  const [showAdvancedOauth, setShowAdvancedOauth] = useState(false);

  // 전역 스토어의 레포 설정이 변경되면 로컬 설정도 동기화 (다른 컴포넌트에서의 변경 반영)
  useEffect(() => {
    if (githubOwner && githubRepo) {
      const fullPath = `${githubOwner}/${githubRepo}`;
      if (oauthConfig.github_repo !== fullPath) {
        setOauthConfig(p => ({ ...p, github_repo: fullPath }));
      }
      // 브랜치 목록 자동 로드 (authToken 준비 후)
      if (authToken && branchList.length === 0) {
        loadBranches(githubOwner, githubRepo);
      }
    }
  }, [githubOwner, githubRepo, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authToken || !currentUser?.team_id) return;
    serverRequest(`/api/teams/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((data) => {
        const d = data.team;
        if (!d) return;
        setOauthConfig((p) => ({
          ...p,
          client_id: d.github_client_id || "",
          github_repo: d.github_repo || "",
        }));
        if (d.github_repo) {
          const parts = d.github_repo.split("/");
          if (parts.length === 2) {
            setGithubSettings(githubToken, parts[0], parts[1]);
          }
        }
      })
      .catch(() => {});
  }, [authToken, currentUser?.team_id]);

  const saveOauthConfig = async () => {
    if (!currentUser?.team_id) return;
    setOauthLoading(true);
    setOauthStatus(null);
    try {
      const payload = { github_repo: oauthConfig.github_repo };
      if (oauthConfig.client_id) payload.client_id = oauthConfig.client_id;
      if (oauthConfig.client_secret) payload.client_secret = oauthConfig.client_secret;

      const json = await serverRequest(`/api/teams/me/github`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload),
      });
      if (json.status === "ok") setOauthStatus("ok");
      else throw new Error(json.detail || "저장 실패");
    } catch (e) {
      setOauthStatus("error");
    } finally {
      setOauthLoading(false);
    }
  };

  // ── Auto Save Logic ──
  const oauthSaveTimer = useRef(null);
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    clearTimeout(oauthSaveTimer.current);
    oauthSaveTimer.current = setTimeout(saveOauthConfig, 1000);
    return () => clearTimeout(oauthSaveTimer.current);
  }, [oauthConfig.client_id, oauthConfig.client_secret]);

  const loadRepos = async () => {
    if (!isGithubConnected) return;
    setRepoLoading(true);
    setRepoScopeError(false);
    setShowRepoPicker(false);
    try {
      const data = await serverRequest("/auth/github/repos", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (data.status === "ok") {
        setRepoList(data.repos);
        setShowRepoPicker(true);
      } else {
        setRepoScopeError(true);
      }
    } catch (_) {
      setRepoScopeError(true);
    } finally {
      setRepoLoading(false);
    }
  };

  const loadBranches = async (owner, repo) => {
    if (!owner || !repo || !authToken) return;
    setBranchLoading(true);
    try {
      const data = await serverRequest(`/auth/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (data.status === "ok") setBranchList(data.data || []);
    } catch (_) {}
    finally { setBranchLoading(false); }
  };

  const selectRepo = async (repo) => {
    setOauthConfig((p) => ({ ...p, github_repo: repo.full_name }));
    setGithubSettings(githubToken, repo.owner, repo.name, "main");
    setShowRepoPicker(false);
    setRepoSearch("");
    loadBranches(repo.owner, repo.name);

    if (currentUser?.team_id) {
      try {
        await serverRequest(`/auth/teams/${currentUser.team_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ github_repo: repo.full_name }),
        });
      } catch (_) {}
    }
  };

  const [deviceFlowData, setDeviceFlowData] = useState(null);
  const [ghPolling, setGhPolling] = useState(false);
  const [ghError, setGhError] = useState("");

  const pollTimerRef = useRef(null);
  const deviceAttemptRef = useRef(0);
  useEffect(() => () => {
    deviceAttemptRef.current++;
    clearTimeout(pollTimerRef.current);
    useAppStore.getState().cancelGithubDeviceFlow();
  }, []);

  const stopPolling = (message = "") => {
    deviceAttemptRef.current++;
    clearTimeout(pollTimerRef.current);
    useAppStore.getState().cancelGithubDeviceFlow();
    setDeviceFlowData(null); setGhPolling(false); setGhError(message);
  };
  const startGithubLogin = async () => {
    stopPolling();
    const attempt = ++deviceAttemptRef.current;
    const current = () => deviceAttemptRef.current === attempt;
    setGhPolling(true);
    try {
      const data = await startGithubDeviceFlow();
      if (!current()) return;
      setDeviceFlowData(data);
      window.open(data.verification_uri, "_blank", "noopener,noreferrer");
      const schedule = (seconds) => {
        pollTimerRef.current = setTimeout(async () => {
          if (!current()) return;
          const result = await pollGithubDeviceFlow(data.device_code);
          if (!current()) return;
          if (result.status === "ok") stopPolling();
          else if (result.status === "error") {
            const messages = {access_denied: "GitHub 인증이 취소되었습니다.",
              expired_token: "인증 코드가 만료되었습니다. 다시 시작해주세요.",
              incorrect_client_credentials: "서버의 GitHub OAuth 설정을 확인해주세요."};
            stopPolling(messages[result.error] || result.error || "인증 실패");
          } else schedule(result.interval || data.interval);
        }, seconds * 1000);
      };
      schedule(data.interval);
    } catch (error) { if (current()) stopPolling(error.message); }
  };
  const cancelGithubLogin = () => stopPolling();

  const inputCls = `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors placeholder-[var(--text-muted)] ${
    isDarkMode ? "bg-black/20 border-[var(--border)] text-[var(--text-primary)]" : "bg-slate-50 border-slate-200 text-slate-900"
  }`;
  const sectionCls = `glass-card rounded-2xl overflow-hidden`;
  const SectionHeader = ({ icon: Icon, title, badge }) => (
    <div className={`flex items-center gap-2.5 px-5 py-3.5 border-b ${isDarkMode ? "border-white/5 bg-white/[0.02]" : "border-slate-100 bg-slate-50/60"}`}>
      <Icon size={14} className="opacity-50 shrink-0" />
      <span className="text-xs font-bold uppercase tracking-wide opacity-60">{title}</span>
      {badge}
    </div>
  );

  const ROLE_META = {
    pm:               { label: "PM",       full: "PM (프로덕트 매니저)",        cls: "bg-purple-500/15 text-purple-400 border-purple-500/20" },
    software_engineer:{ label: "SWE",      full: "Software Engineer (개발자)",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
    backend:          { label: "Backend",  full: "Backend (백엔드)",            cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
    frontend:         { label: "Frontend", full: "Frontend (프론트엔드)",       cls: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
    devops:           { label: "DevOps",   full: "DevOps",                      cls: "bg-rose-500/15 text-rose-400 border-rose-500/20" },
  };
  const RoleBadge = ({ role }) => {
    const meta = ROLE_META[role] || { label: role, cls: "bg-slate-500/15 text-slate-400 border-slate-500/20" };
    return (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
    );
  };

  const sectionGithub = (
        <div className={sectionCls}>
          <SectionHeader
            icon={Github}
            title="GitHub 연동"
            badge={isGithubConnected && (
              <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                <Check size={9} /> 연결됨
              </span>
            )}
          />

          <div className="p-4 space-y-4">
            {/* 연결 상태 */}
            {isGithubConnected ? (
              <div className={`flex items-center gap-3 p-3 rounded-xl ${
                isDarkMode ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"
              }`}>
                <Github size={16} className="text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold truncate ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
                    @{currentUser?.github_login}
                  </p>
                  <p className="text-[10px] opacity-50">GitHub 계정으로 연결됨</p>
                </div>
                <button
                  onClick={disconnectGithub}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    isDarkMode ? "bg-white/10 hover:bg-red-500/20 text-slate-400 hover:text-red-400" : "bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200"
                  }`}
                >
                  해제
                </button>
              </div>
            ) : deviceFlowData ? (
              <div className={`space-y-3 p-3 rounded-xl border ${isDarkMode ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
                <p className="text-xs opacity-60 text-center">GitHub에서 아래 코드를 입력하세요</p>
                <div className="text-2xl font-black tracking-widest text-blue-400 text-center py-2">
                  {deviceFlowData.user_code}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.open(deviceFlowData.verification_uri, "_blank")}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all"
                  >
                    <Github size={12} /> GitHub에서 인증
                  </button>
                  <button
                    onClick={cancelGithubLogin}
                    className={`px-3 py-2 rounded-lg text-xs transition-all ${isDarkMode ? "bg-white/5 hover:bg-white/10 text-slate-400" : "bg-white hover:bg-slate-100 text-slate-600 border border-slate-200"}`}
                  >
                    취소
                  </button>
                </div>
                {ghPolling && (
                  <div className="flex items-center justify-center gap-2 text-xs opacity-40">
                    <Loader2 size={11} className="animate-spin" /> 인증 대기 중...
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={startGithubLogin}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  isDarkMode
                    ? "bg-white/10 hover:bg-white/15 text-white border border-white/10"
                    : "bg-slate-900 hover:bg-slate-800 text-white"
                }`}
              >
                <Github size={15} /> GitHub로 연결하기
              </button>
            )}

            {ghError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5 px-1">
                <X size={11} /> {ghError}
              </p>
            )}

            {/* 레포지토리 & 브랜치 */}
            {isGithubConnected && (
              <div className={`space-y-3 pt-1 border-t ${isDarkMode ? "border-white/5" : "border-slate-100"}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-40 pt-1">워크스페이스</p>

                <div className="space-y-1.5">
                  <label className="text-xs opacity-60 font-semibold">대상 레포지토리</label>
                  <div className="flex gap-2">
                    <div className={`flex-1 px-3 py-2 text-sm border rounded-lg truncate font-medium ${
                      isDarkMode ? "bg-black/20 border-[var(--border)] text-[var(--text-primary)]" : "bg-slate-50 border-slate-200 text-slate-900"
                    } ${!oauthConfig.github_repo ? "opacity-40" : ""}`}>
                      {oauthConfig.github_repo || "레포를 선택하세요"}
                    </div>
                    <button
                      onClick={loadRepos}
                      disabled={repoLoading}
                      className={`px-3 py-2 text-xs font-bold rounded-lg transition-all shrink-0 ${
                        isDarkMode ? "bg-white/10 hover:bg-white/20 text-slate-300 disabled:opacity-30" : "bg-slate-200 hover:bg-slate-300 text-slate-700 disabled:opacity-30"
                      }`}
                    >
                      {repoLoading ? <Loader2 size={13} className="animate-spin" /> : "선택"}
                    </button>
                  </div>

                  {repoScopeError && (
                    <p className="text-[10px] text-amber-400 flex items-center gap-1">
                      <X size={10} /> 재연결이 필요합니다 (연결 해제 후 다시 연결)
                    </p>
                  )}

                  {showRepoPicker && repoList.length > 0 && (
                    <div className={`border rounded-xl overflow-hidden shadow-xl ${
                      isDarkMode ? "bg-[#1a1f2e] border-[var(--border)]" : "bg-white border-slate-200"
                    }`}>
                      <div className={`px-3 py-2 border-b ${isDarkMode ? "border-[var(--border)]" : "border-slate-100"}`}>
                        <input
                          autoFocus
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          placeholder="레포 검색..."
                          className="w-full text-xs bg-transparent outline-none"
                        />
                      </div>
                      <ul className="max-h-48 overflow-y-auto">
                        {repoList
                          .filter((r) => r.full_name.toLowerCase().includes(repoSearch.toLowerCase()))
                          .map((repo) => (
                            <li
                              key={repo.full_name}
                              onClick={() => selectRepo(repo)}
                              className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                                isDarkMode ? "hover:bg-white/5 text-[var(--text-primary)]" : "hover:bg-slate-50 text-slate-800"
                              } ${oauthConfig.github_repo === repo.full_name ? (isDarkMode ? "bg-blue-500/10" : "bg-blue-50") : ""}`}
                            >
                              <span className="font-semibold truncate text-xs">{repo.name}</span>
                              <span className="text-[10px] opacity-40 shrink-0">{repo.owner}</span>
                              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                                {repo.language && <span className="text-[10px] opacity-30">{repo.language}</span>}
                                {repo.private && <span className="text-[10px] text-amber-400 font-bold">private</span>}
                              </span>
                            </li>
                          ))}
                        {repoList.filter((r) => r.full_name.toLowerCase().includes(repoSearch.toLowerCase())).length === 0 && (
                          <li className="px-3 py-3 text-xs opacity-30 text-center">검색 결과 없음</li>
                        )}
                      </ul>
                      <div className={`px-3 py-1.5 border-t text-right ${isDarkMode ? "border-[var(--border)]" : "border-slate-100"}`}>
                        <button onClick={() => setShowRepoPicker(false)} className="text-[10px] opacity-30 hover:opacity-60 transition-opacity">닫기</button>
                      </div>
                    </div>
                  )}
                </div>

                {githubOwner && githubRepo && (
                  <div className="space-y-1.5">
                    <label className="text-xs opacity-60 font-semibold">기본 브랜치</label>
                    <div className="flex gap-2">
                      <select
                        value={githubBranch}
                        onChange={(e) => setGithubBranch(e.target.value)}
                        className={`${inputCls} flex-1 cursor-pointer`}
                        style={{ colorScheme: isDarkMode ? "dark" : "light" }}
                      >
                        {branchList.length === 0 && (
                          <option value={githubBranch} className={isDarkMode ? "bg-[#1a1a2e] text-white" : "bg-white text-slate-900"}>
                            {githubBranch}
                          </option>
                        )}
                        {branchList.map((b) => (
                          <option 
                            key={b.name} 
                            value={b.name} 
                            className={isDarkMode ? "bg-[#1a1a2e] text-white" : "bg-white text-slate-900"}
                          >
                            {b.name}{b.protected ? " 🔒" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => loadBranches(githubOwner, githubRepo)}
                        disabled={branchLoading}
                        className={`px-3 py-2 text-xs font-bold rounded-lg transition-all shrink-0 ${
                          isDarkMode ? "bg-white/10 hover:bg-white/20 text-slate-300 disabled:opacity-30" : "bg-slate-200 hover:bg-slate-300 text-slate-700 disabled:opacity-30"
                        }`}
                      >
                        {branchLoading ? <Loader2 size={13} className="animate-spin" /> : "↻"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 고급 OAuth 설정 */}
            <div>
              <button
                onClick={() => setShowAdvancedOauth(!showAdvancedOauth)}
                className={`text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                  showAdvancedOauth ? "text-blue-400" : "opacity-40 hover:opacity-70"
                }`}
              >
                <ChevronDown size={11} className={`transition-transform ${showAdvancedOauth ? "rotate-180" : ""}`} />
                {showAdvancedOauth ? "OAuth App 설정 닫기" : "고급: OAuth App 설정"}
              </button>

              {showAdvancedOauth && (
                <div className={`mt-2 space-y-2 p-3 rounded-xl border ${
                  isDarkMode ? "bg-black/20 border-white/5" : "bg-slate-50 border-slate-200"
                }`}>
                  <input
                    type="text"
                    value={oauthConfig.client_id}
                    onChange={(e) => setOauthConfig(p => ({ ...p, client_id: e.target.value }))}
                    placeholder="Client ID"
                    className={inputCls}
                  />
                  <input
                    type="password"
                    value={oauthConfig.client_secret}
                    onChange={(e) => setOauthConfig(p => ({ ...p, client_secret: e.target.value }))}
                    placeholder="새 Client Secret (비워두면 유지)"
                    className={inputCls}
                  />
                </div>
              )}
            </div>

            {/* 저장 상태 */}
            <div className="text-[10px] opacity-50 flex items-center gap-1">
              {oauthLoading ? (
                <><Loader2 size={9} className="animate-spin" /> 저장 중...</>
              ) : oauthStatus === "ok" ? (
                <span className="text-emerald-400 opacity-100"><Check size={9} className="inline mr-1" />자동 저장됨</span>
              ) : oauthStatus === "error" ? (
                <span className="text-red-400 opacity-100"><X size={9} className="inline mr-1" />저장 실패</span>
              ) : "변경 시 자동 저장"}
            </div>
          </div>
        </div>
  );


  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-5 space-y-4">
        {sectionGithub}
      </div>
    </div>
  );
}
