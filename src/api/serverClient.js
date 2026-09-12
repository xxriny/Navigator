/** Cloud Run HTTP client. Only a rejected current bearer session may clear auth. */
export const SERVER_URL = "https://navigator-server-681502864272.asia-northeast3.run.app";

export async function serverRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get("Authorization") || "")?.[1];
  try {
    const response = await fetch(`${SERVER_URL}${path}`, { ...options, headers, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(typeof body.detail === "string" ? body.detail :
        typeof body.message === "string" ? body.message : `Server Error: ${response.status}`);
      error.status = response.status;
      // Login/register 401 is a credential error, not expiry of the active session.
      if (response.status === 401 && bearer && !["/auth/login", "/auth/register"].includes(path)) {
        const { default: useAppStore } = await import("../store/useAppStore.js");
        const state = useAppStore.getState();
        if (state.authToken === bearer) state.clearAuth();
      }
      throw error;
    }
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("요청 시간이 초과되었습니다. 연결을 확인하고 다시 시도해주세요.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
