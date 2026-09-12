import { request } from "../apiClient";

export const sessionService = {
  async createProject(port, title, teamId, token, clientRequestId) {
    return request(port, "/api/projects", { method: "POST", headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, team_id: teamId || null, client_request_id: clientRequestId }) });
  },
  async getProject(port, id, token) {
    return request(port, `/api/projects/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  },
  /** 세션 복구 (RAG 데이터 기반) */
  async restoreSession(port, runId, token) {
    return request(port, `/api/session/${encodeURIComponent(runId)}/restore`, {headers: {Authorization: `Bearer ${token}`}});
  },

  /** 세션 삭제 */
  async deleteSession(port, runId, token) {
    return request(port, `/api/session/${encodeURIComponent(runId)}`, { method: "DELETE", headers: {Authorization: `Bearer ${token}`} });
  },

  /** 메모(메모) 목록 조회 */
  async getMemos(port, sessionId, token) {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    return request(port, `/api/memos${query}`, { headers: { Authorization: `Bearer ${token}` } });
  },

  /** 메모 추가 */
  async addMemo(port, memoData, token) {
    return request(port, "/api/memos", {
      method: "POST",
      body: JSON.stringify(memoData),
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  /** 메모 삭제 */
  async removeMemo(port, memoId, token) {
    return request(port, `/api/memos/${memoId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  },

  /** 메모 일괄 적용 표시 (UPDATE 분석 성공 후 호출) */
  async applyMemos(port, memoIds, reflectedVersion = null, token) {
    const body = { memo_ids: memoIds || [] };
    if (reflectedVersion) body.reflected_version = reflectedVersion;
    return request(port, "/api/memos/apply", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}` },
    });
  }
};
