import React, { useState, useEffect, useRef } from "react";
import useAppStore from "../../store/useAppStore";
import { platform } from "../../platform/index.js";
import { serverRequest } from "../../api/serverClient";
import {
  LogIn, UserPlus, Eye, EyeOff, Loader2, Github,
  AlertCircle, Settings, ExternalLink, ChevronUp, ChevronDown, CheckCircle2,
} from "lucide-react";

const ROLES = [
  { value: "pm",               label: "PM (프로덕트 매니저)" },
  { value: "software_engineer",label: "Software Engineer (개발자)" },
  { value: "frontend",         label: "Frontend (프론트엔드)" },
  { value: "backend",          label: "Backend (백엔드)" },
  { value: "devops",           label: "DevOps" },
];

const DEVICE_IDLE = "idle";
const DEVICE_STARTING = "starting";
const DEVICE_WAITING = "waiting";

// ── 좌측 패널 카피 ────────────────────────────────────────────
const HERO_LINES = [
  { en: "Analyze first.", ko: "먼저 분석하고," },
  { en: "Then architect.", ko: "그 다음 설계하세요." },
];

export default function LoginScreen({ isFirstRun = false }) {
  const login               = useAppStore((s) => s.login);
  const register            = useAppStore((s) => s.register);
  const checkAuthStatus     = useAppStore((s) => s.checkAuthStatus);
  const startGithubDeviceFlow = useAppStore((s) => s.startGithubDeviceFlow);
  const pollGithubDeviceFlow  = useAppStore((s) => s.pollGithubDeviceFlow);

  const [mode, setMode]           = useState(isFirstRun ? "register" : "login");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  // 초대 코드 처리
  const inviteCode = new URLSearchParams(window.location.search).get("invite");

  const [deviceState, setDeviceState] = useState(DEVICE_IDLE);
  const [deviceSuccess, setDeviceSuccess] = useState(false);
  const [userCode, setUserCode]       = useState("");
  const [verificationUri, setVerificationUri] = useState("https://github.com/login/device");
  const [ghError, setGhError]         = useState("");

  const [showAdvanced, setShowAdvanced] = useState(false);

  const pollRef = useRef(null);
  const deviceAttemptRef = useRef(0);
  const [form, setForm] = useState({
    name: "", email: "", password: "", role: "software_engineer",
    github_username: "", team_name: "",
  });
  const setField = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => () => {
    deviceAttemptRef.current++;
    clearTimeout(pollRef.current);
    useAppStore.getState().cancelGithubDeviceFlow();
  }, []);

  const cancelDeviceFlow = () => {
    deviceAttemptRef.current++;
    clearTimeout(pollRef.current); pollRef.current = null;
    useAppStore.getState().cancelGithubDeviceFlow();
    setDeviceState(DEVICE_IDLE); setGhError(""); setUserCode("");
  };
  const switchMode = (m) => {
    cancelDeviceFlow();
    setMode(m); setError(""); setShowOptional(false);
  };
  const startDeviceFlow = async () => {
    clearTimeout(pollRef.current);
    const attempt = ++deviceAttemptRef.current;
    const current = () => attempt === deviceAttemptRef.current;
    setDeviceState(DEVICE_STARTING); setGhError(""); setDeviceSuccess(false);
    const messages = {expired_token: "인증 코드가 만료되었습니다. 다시 시작해주세요.",
      access_denied: "GitHub 인증이 취소되었습니다.",
      incorrect_client_credentials: "서버의 GitHub OAuth 설정을 확인해주세요.",
      device_flow_disabled: "서버 관리자가 GitHub 앱에서 Device Flow를 활성화해야 합니다."};
    try {
      const data = await startGithubDeviceFlow();
      if (!current()) return;
      setUserCode(data.user_code); setVerificationUri(data.verification_uri);
      setDeviceState(DEVICE_WAITING);
      platform.openExternal(data.verification_uri);
      const schedule = (seconds) => {
        pollRef.current = setTimeout(async () => {
          if (!current()) return;
          const result = await pollGithubDeviceFlow(data.device_code);
          if (!current()) return;
          if (result.status === "ok") {
            pollRef.current = null; setDeviceSuccess(true);
          } else if (result.status === "error") {
            pollRef.current = null; setDeviceState(DEVICE_IDLE);
            setGhError(messages[result.error] || result.error || "GitHub 인증 실패");
          } else schedule(result.interval || data.interval);
        }, seconds * 1000);
      };
      schedule(data.interval);
    } catch (error) {
      if (!current()) return;
      setDeviceState(DEVICE_IDLE); setGhError(error.message || "GitHub 인증 시작 실패");
      if (error.status === 503) setShowAdvanced(true);
    }
  };
  const openBrowser = () => platform.openExternal(verificationUri);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      mode === "login"
        ? await login(form.email, form.password)
        : await register({
            name: form.name, email: form.email, password: form.password,
            role: form.role,
            github_username: form.github_username || undefined,
            team_name: form.team_name || undefined,
          });
          
      if (inviteCode) {
        try {
          const token = useAppStore.getState().authToken;
          if (token) {
            await serverRequest(`/auth/invites/${inviteCode}/join`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
            window.history.replaceState({}, document.title, window.location.pathname);
            await checkAuthStatus();
          }
        } catch (_) {}
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <>
      {/* 전역 keyframe 주입 */}
      <style>{`
        @keyframes nav-orb-1 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(60px,-40px) scale(1.15); }
          66%      { transform: translate(-30px,50px) scale(0.92); }
        }
        @keyframes nav-orb-2 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(-50px,60px) scale(1.1); }
          66%      { transform: translate(40px,-30px) scale(0.95); }
        }
        @keyframes nav-orb-3 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(30px,40px) scale(1.2); }
        }
        @keyframes nav-fade-up {
          from { opacity:0; transform:translateY(18px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .nav-fade-up { animation: nav-fade-up 0.55s ease both; }
        .nav-fade-up-1 { animation: nav-fade-up 0.55s 0.1s ease both; }
        .nav-fade-up-2 { animation: nav-fade-up 0.55s 0.2s ease both; }
      `}</style>

      <div className="h-screen w-screen flex overflow-hidden" style={{ background: "#0D1117" }}>

        {/* ══════════════════════════════════════════
            좌측 패널 — 애니메이션 + 브랜드 카피
        ══════════════════════════════════════════ */}
        <div className="hidden md:flex flex-col justify-between flex-1 relative overflow-hidden p-12"
          style={{ background: "#0D1117" }}>

          {/* 배경 오브 */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", width: 520, height: 520,
              top: "5%", left: "10%",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)",
              animation: "nav-orb-1 14s ease-in-out infinite",
              filter: "blur(2px)",
            }} />
            <div style={{
              position: "absolute", width: 420, height: 420,
              bottom: "10%", right: "5%",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)",
              animation: "nav-orb-2 18s ease-in-out infinite",
              filter: "blur(2px)",
            }} />
            <div style={{
              position: "absolute", width: 300, height: 300,
              top: "40%", right: "20%",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)",
              animation: "nav-orb-3 12s ease-in-out infinite",
              filter: "blur(1px)",
            }} />
            {/* 격자 오버레이 */}
            <div style={{
              position: "absolute", inset: 0,
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
              `,
              backgroundSize: "48px 48px",
            }} />
          </div>

          {/* 로고 */}
          <div className="relative z-10 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #2563EB, #7C3AED)" }}>
              <span className="text-sm font-black text-white">N</span>
            </div>
            <span className="text-sm font-bold text-white/80 tracking-wide">NAVIGATOR</span>
          </div>

          {/* 중앙 카피 */}
          <div className="relative z-10">
            <p className="text-xs font-semibold tracking-widest uppercase mb-5 nav-fade-up"
              style={{ color: "rgba(139,92,246,0.9)" }}>
              AI-Powered PM &amp; SA Platform
            </p>
            {HERO_LINES.map((line, i) => (
              <div key={i} className={`nav-fade-up-${i + 1}`}>
                <h2 className="font-black leading-tight"
                  style={{
                    fontSize: "clamp(28px, 3.5vw, 48px)",
                    color: i === 0 ? "#E6EDF3" : "rgba(230,237,243,0.55)",
                  }}>
                  {line.en}
                </h2>
              </div>
            ))}
            <p className="mt-6 text-sm leading-relaxed nav-fade-up-2"
              style={{ color: "rgba(139,148,158,0.85)", maxWidth: 360 }}>
              GitHub 리포지토리를 연결하면 AI가 요구사항 분석부터
              소프트웨어 아키텍처 설계까지 자동으로 처리합니다.
            </p>
          </div>

          {/* 하단 뱃지 */}
          <div className="relative z-10 flex items-center gap-4">
            {["PM 분석", "SA 설계", "GitHub 연동", "팀 협업"].map((tag) => (
              <span key={tag}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  color: "rgba(230,237,243,0.6)",
                }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════
            우측 패널 — 로그인 폼
        ══════════════════════════════════════════ */}
        <div className="flex items-center justify-center w-full md:w-[420px] shrink-0 p-6"
          style={{ background: "#0D1117", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>

          <div className="w-full max-w-sm flex flex-col gap-7">

            {/* 모바일 로고 (md 이상에서는 숨김) */}
            <div className="flex md:hidden items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #2563EB, #7C3AED)" }}>
                <span className="text-xs font-black text-white">N</span>
              </div>
              <span className="text-sm font-bold text-white/80">NAVIGATOR</span>
            </div>

            {/* 타이틀 */}
            <div>
              <h1 className="text-xl font-black text-white mb-1">
                {mode === "login" ? "로그인" : "새 계정 만들기"}
              </h1>
              <p className="text-xs" style={{ color: "#8B949E" }}>
                {mode === "login"
                  ? "팀 계정으로 로그인하세요."
                  : "계정을 만들고 팀을 시작하세요."}
              </p>
            </div>

            {/* 초대 배너 */}
            {inviteCode && (
              <div className="flex items-center gap-2 p-3 rounded-xl border" style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)" }}>
                <CheckCircle2 size={16} className="text-blue-400 shrink-0" />
                <p className="text-xs text-blue-300">
                  <strong className="text-blue-200">초대 링크</strong>를 통해 오셨습니다. 로그인하거나 가입하면 자동으로 팀에 합류합니다.
                </p>
              </div>
            )}

            {/* GitHub Device Flow 대기 */}
            {deviceState === DEVICE_WAITING ? (
              <DeviceWaitPanel
                userCode={userCode}
                ghError={ghError}
                onOpen={openBrowser}
                onCancel={cancelDeviceFlow}
                success={deviceSuccess}
              />
            ) : (
              <>
                {/* 탭 */}
                <div className="flex rounded-xl overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.04)", padding: "3px" }}>
                  {[
                    { key: "login", label: "로그인" },
                    { key: "register", label: "회원가입" },
                  ].map(({ key, label }) => (
                    <button key={key} onClick={() => switchMode(key)}
                      className="flex-1 py-2 text-xs font-bold rounded-lg transition-all"
                      style={{
                        background: mode === key ? "#1F2937" : "transparent",
                        color: mode === key ? "#60A5FA" : "#8B949E",
                      }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* 폼 */}
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  {mode === "register" && (
                    <>
                      <DarkField label="이름" value={form.name}
                        onChange={setField("name")} placeholder="홍길동" required />
                      <div>
                        <label className="block text-[11px] font-semibold mb-1.5"
                          style={{ color: "#8B949E" }}>역할</label>
                        <select value={form.role} onChange={setField("role")}
                          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                          style={{
                            background: "#0D1117",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "#E6EDF3",
                          }}>
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  <DarkField label="이메일" type="email" value={form.email}
                    onChange={setField("email")} placeholder="you@example.com" required />

                  <DarkPasswordField value={form.password}
                    onChange={setField("password")} show={showPw}
                    onToggle={() => setShowPw((p) => !p)} />

                  {mode === "register" && (
                    <div>
                      <button type="button"
                        onClick={() => setShowOptional((v) => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold transition-colors"
                        style={{ color: showOptional ? "#60A5FA" : "#8B949E" }}>
                        {showOptional ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        추가 정보 (선택)
                      </button>
                      {showOptional && (
                        <div className="mt-2.5 flex flex-col gap-2.5">
                          <DarkField label="팀 이름" value={form.team_name}
                            onChange={setField("team_name")} placeholder="예: NAVIGATOR Team" />
                          <DarkField label="GitHub 아이디" value={form.github_username}
                            onChange={setField("github_username")} placeholder="github-username" />
                        </div>
                      )}
                    </div>
                  )}

                  {error && <ErrorBox msg={error} />}

                  <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #2563EB, #4F46E5)" }}>
                    {loading
                      ? <Loader2 size={15} className="animate-spin" />
                      : mode === "login" ? <LogIn size={14} /> : <UserPlus size={14} />}
                    {mode === "login" ? "로그인" : "계정 만들기"}
                  </button>
                </form>

                {/* 구분선 */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                  <span className="text-[11px]" style={{ color: "#8B949E" }}>또는</span>
                  <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                </div>

                {/* GitHub */}
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button type="button" onClick={startDeviceFlow}
                      disabled={deviceState === DEVICE_STARTING}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.09)",
                        color: "#E6EDF3",
                      }}>
                      {deviceState === DEVICE_STARTING
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Github size={14} />}
                      GitHub로 로그인
                    </button>
                    <button type="button" onClick={() => setShowAdvanced((v) => !v)}
                      title="GitHub 로그인 설정 안내"
                      className="px-3.5 rounded-xl transition-all"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.09)",
                        color: "#8B949E",
                      }}>
                      {showAdvanced ? <ChevronUp size={14} /> : <Settings size={14} />}
                    </button>
                  </div>

                  {ghError && <ErrorBox msg={ghError} />}

                  {showAdvanced && (
                    <div className="rounded-xl p-4 flex flex-col gap-3"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}>
                      <p className="text-[11px] font-bold text-white/80">GitHub 로그인 설정 안내</p>
                      <p className="text-xs leading-relaxed" style={{color: "#8B949E"}}>
                        GitHub 로그인은 서버에 등록된 공통 OAuth 앱을 사용합니다.
                        설정 오류가 표시되면 서버 관리자에게 문의해주세요.
                        로그인 후 선택하는 팀과 저장소 설정은 별도로 적용됩니다.
                      </p>
                      <button onClick={() => setShowAdvanced(false)} className="py-2 text-xs text-white/80">닫기</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────

function DeviceWaitPanel({ userCode, ghError, onOpen, onCancel, success }) {
  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl p-6 text-center"
        style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
        <CheckCircle2 size={36} style={{ color: "#22C55E" }} />
        <p className="text-sm font-bold" style={{ color: "#22C55E" }}>GitHub 인증 완료</p>
        <div className="flex items-center gap-2">
          <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "#8B949E" }} />
          <p className="text-[11px]" style={{ color: "#8B949E" }}>이동 중...</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-2xl p-5"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="text-center">
        <p className="text-xs font-bold text-white/80 mb-0.5">GitHub에서 코드를 입력하세요</p>
        <p className="text-[11px]" style={{ color: "#8B949E" }}>github.com/login/device</p>
      </div>
      <div className="rounded-xl py-5 text-center"
        style={{ background: "#0D1117", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span className="font-mono text-3xl font-black tracking-[0.35em] select-all"
          style={{ color: "#60A5FA" }}>
          {userCode}
        </span>
      </div>
      <button onClick={onOpen}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white"
        style={{ background: "linear-gradient(135deg, #2563EB, #4F46E5)" }}>
        <ExternalLink size={13} /> 브라우저에서 인증하기
      </button>
      <div className="flex items-center gap-2">
        <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "#60A5FA" }} />
        <p className="text-[11px]" style={{ color: "#8B949E" }}>인증 완료 시 자동으로 로그인됩니다</p>
      </div>
      {ghError && <ErrorBox msg={ghError} />}
      <button onClick={onCancel}
        className="w-full py-2 rounded-xl text-xs font-bold"
        style={{ background: "rgba(255,255,255,0.05)", color: "#8B949E" }}>
        취소
      </button>
    </div>
  );
}

function DarkField({ label, value, onChange, placeholder, type = "text", required, small }) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      {label && (
        <label className={`block font-semibold mb-1.5 ${small ? "text-[10px]" : "text-[11px]"}`}
          style={{ color: "#8B949E" }}>
          {label}
        </label>
      )}
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        required={required}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className={`w-full rounded-xl outline-none transition-all ${small ? "px-3 py-2 text-xs" : "px-3 py-2.5 text-sm"}`}
        style={{
          background: "#0D1117",
          border: `1px solid ${focused ? "#3B82F6" : "rgba(255,255,255,0.1)"}`,
          color: "#E6EDF3",
          boxShadow: focused ? "0 0 0 3px rgba(59,130,246,0.15)" : "none",
        }}
      />
    </div>
  );
}

function DarkPasswordField({ value, onChange, show, onToggle }) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-[11px] font-semibold mb-1.5" style={{ color: "#8B949E" }}>
        비밀번호
      </label>
      <div className="relative">
        <input type={show ? "text" : "password"} value={value} onChange={onChange}
          placeholder="••••••••" required
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          className="w-full rounded-xl px-3 py-2.5 pr-10 text-sm outline-none transition-all"
          style={{
            background: "#0D1117",
            border: `1px solid ${focused ? "#3B82F6" : "rgba(255,255,255,0.1)"}`,
            color: "#E6EDF3",
            boxShadow: focused ? "0 0 0 3px rgba(59,130,246,0.15)" : "none",
          }}
        />
        <button type="button" onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
          style={{ color: "#8B949E" }}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function ErrorBox({ msg }) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
      <AlertCircle size={12} className="mt-0.5 shrink-0 text-red-400" />
      <p className="text-[11px] font-medium text-red-400">{msg}</p>
    </div>
  );
}
