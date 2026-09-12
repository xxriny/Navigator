/**
 * Store 헬퍼 — useAppStore에서 추출된 순수 함수들
 */

export const SESSION_STORAGE_KEY = "pm_sessions";
export const DEFAULT_VIEWPORT_TAB = { kind: "output", id: "home" };

export const MODE_TO_ACTION_TYPE = {
  create: "CREATE",
  update: "UPDATE",
  reverse: "REVERSE_ENGINEER",
};

export const MODE_TO_PIPELINE_TYPE = {
  create: "analysis_create",
  update: "analysis_update",
  reverse: "analysis_reverse",
};

export function normalizeMode(mode) {
  return MODE_TO_ACTION_TYPE[mode] ? mode : "create";
}

// Legacy pm_sessions is preserved for explicit migration, never automatically claimed.
export function ownsLocalSession(session, user) {
  return !!user?.id && session?.owner_user_id === user.id &&
    (session.team_id || null) === (user.team_id || null);
}

export function sessionStorageKey(user) {
  return user?.id ? `${SESSION_STORAGE_KEY}:v2:${encodeURIComponent(user.id)}:${encodeURIComponent(user.team_id || "")}` : null;
}

export function loadSessions(user) {
  const key = sessionStorageKey(user);
  if (!key) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(rows) ? rows.filter(row => ownsLocalSession(row, user)) : [];
  } catch { return []; }
}

export function persistSessions(sessions, user) {
  const key = sessionStorageKey(user);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(sessions.filter(row => ownsLocalSession(row, user))));
  } catch { /* The current in-memory workspace remains available on quota failure. */ }
}

export function cloneViewportTab(tab) {
  return tab ? { kind: tab.kind, id: tab.id } : { ...DEFAULT_VIEWPORT_TAB };
}

export function normalizeOutputTabId(tabId) {
  if (tabId === "sa_overview" || tabId === "sa_feasibility") {
    return "overview";
  }
  if (tabId === "topology") {
    return "context";
  }
  return tabId;
}

export function extractRunId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/(\d{8}_\d{6})/);
  return match ? match[1] : null;
}

export function inferPipelineTypeFromResult(data) {
  const hinted = data?.pipeline_type;
  if (typeof hinted === "string" && hinted) {
    return hinted;
  }
  const actionType = (data?.metadata?.action_type || "").toUpperCase();
  if (actionType === "REVERSE_ENGINEER") {
    return "analysis_reverse";
  }
  if (actionType === "UPDATE") {
    return "analysis_update";
  }
  return "analysis_create";
}

/**
 * 사용자 메모 배열을 UPDATE 분석용 idea 텍스트로 합성한다.
 * - section 별로 그룹핑하여 LLM이 영역 컨텍스트를 인식하도록 함.
 * - selectedText가 있으면 짧게 잘라 같은 줄에 첨부 (popover로 만들어진 메모용).
 *
 * @param {Array<{text:string, section?:string, selectedText?:string}>} memos
 * @returns {string} idea 텍스트
 */
export function synthesizeMemoIdea(memos) {
  if (!memos || memos.length === 0) return "";

  const grouped = memos.reduce((acc, m) => {
    const sec = (m?.section || "Global").trim() || "Global";
    if (!acc[sec]) acc[sec] = [];
    acc[sec].push(m);
    return acc;
  }, {});

  const sections = Object.entries(grouped)
    .map(([sec, items]) => {
      const lines = items
        .map((m, i) => {
          const text = (m.text || "").trim();
          const sel = m.selectedText
            ? ` (선택: "${m.selectedText.slice(0, 80)}")`
            : "";
          const titleLine = `${i + 1}. ${text}${sel}`;
          const detail = (m.detail || "").trim();
          if (detail) {
            // detail은 들여쓰기로 본문 노출. 줄바꿈은 유지하되 각 줄에 들여쓰기 추가.
            const indented = detail
              .split("\n")
              .map((ln) => `   ${ln}`)
              .join("\n");
            return `${titleLine}\n${indented}`;
          }
          return titleLine;
        })
        .join("\n");
      return `[${sec}]\n${lines}`;
    })
    .join("\n\n");

  return (
    "다음 지적사항/메모들을 기반으로 기존 설계를 업데이트해주세요. " +
    "각 항목은 사용자가 기존 분석 결과를 보면서 남긴 피드백·결정사항입니다.\n\n" +
    sections
  );
}

/** SA 관련 결과 필드의 초기값 (startAnalysis, resetPipeline, loadSession에서 공유) */
export const EMPTY_RESULT_FIELDS = {
  resultData: null,
  requirements_rtm: [],
  semantic_graph: null,
  context_spec: null,
  sa_reverse_context: null,
  sa_output: null,
  sa_artifacts: null,
  rag_index_status: null,
  rag_warnings: [],
  sa_phase2: null,
  sa_phase3: null,
  sa_phase4: null,
  sa_phase5: null,
  sa_phase6: null,
  sa_phase7: null,
  sa_phase8: null,
  pm_bundle: null,
  pm_coverage_rate: 0,
  pm_warnings: [],
  tables: null,
  apis: null,
  components: [],
  tech_stacks: [],
  sa_advisor_output: null,
  metadata: null,
};

/** 배열 타입 검증 및 디버깅 로그 기록 */
function validateArray(key, data, fallback = []) {
  if (Array.isArray(data)) return data;
  if (!data && data !== "") return fallback;

  // 타입 불일치 발생 시 콘솔에 기록 (순환 참조 방지를 위해 store 직접 접근 지양)
  console.warn(`[TypeMismatch] '${key}' expected Array, but got ${typeof data}`, data);

  if (typeof data === "string" && data.length > 0) return [data];
  return fallback;
}

/** resultData에서 개별 필드를 추출하는 공통 로직 (LLM Shaper 최적화) */
export function spreadResultData(data) {
  if (!data) return EMPTY_RESULT_FIELDS;

  // 1. LLM Shaper가 생성한 표준 필드들 (최우선)
  const rtm = validateArray("requirements_rtm", data.requirements_rtm || []);
  const techStacks = validateArray("tech_stacks", data.tech_stacks || []);
  const apis = validateArray("apis", data.apis || []);
  const tables = validateArray("tables", data.tables || []);
  const components = validateArray("components", data.components || []);
  const recommendations = validateArray("recommendations", data.recommendations || []);

  // 2. 과거 데이터 또는 내부 번들에서 추출 (폴백)
  const pmBundle = data.pm_bundle || {};
  const pmData = pmBundle.data || {};

  return {
    resultData: data,
    metadata: data.metadata || {
      project_name: data.project_name,
      status: data.status,
      run_id: data.run_id,
      action_type: data.action_type
    },
    project_overview: data.project_overview || {
      project_name: data.project_name,
      summary: data.summary,
      status: data.status
    },
    // 핵심 리스트 데이터
    requirements_rtm: rtm.length > 0 ? rtm : validateArray("rtm_fallback", pmData.rtm),
    tech_stacks: techStacks.length > 0 ? techStacks : validateArray("stack_fallback", pmData.tech_stacks || pmData.stacks),
    apis: apis,
    tables: tables,
    components: components,
    recommendations: recommendations,

    // 지표 및 요약
    pm_coverage_rate: data.pm_coverage_rate || pmData.coverage_rate || 0,
    pm_warnings: validateArray("pm_warnings", data.pm_warnings || pmData.warnings),
    metrics: data.metrics || { performance: 0, stability: 0, integrity: "UNKNOWN" },
    analysis: {
      summary: data.summary || "분석 결과를 표시할 수 없습니다.",
      source: "llm_shaper"
    },

    // 시스템 필드
    thinking_log: validateArray("thinking_log", data.thinking_log),
    sa_output: data.sa_output || data, // 탭 활성화 호환성
    sa_artifacts: data.sa_artifacts || null,
  };
}
