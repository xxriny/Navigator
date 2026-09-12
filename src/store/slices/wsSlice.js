import { wsUrl } from "../../api/apiClient";

export const createWsSlice = (set, get) => ({
  backendPort: null, wsConnection: null, wsStatus: "disconnected", wsRetryCount: 0,
  setBackendPort: port => set({backendPort: port}),
  setWsStatus: status => set({wsStatus: status}),
  resetWebSocket: () => {
    const ws = get().wsConnection;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); }
    set({wsConnection: null, wsStatus: "disconnected", wsRetryCount: 0});
    if (get().backendPort && get().authToken) get().connectWebSocket(get().backendPort);
  },
  connectWebSocket: port => {
    const current = get().wsConnection;
    if (current && [WebSocket.OPEN, WebSocket.CONNECTING].includes(current.readyState)) return;
    const generation = get().authGeneration;
    const ws = new WebSocket(wsUrl("/ws/pipeline", port));
    set({wsConnection: ws, wsStatus: "connecting"});
    const active = () => get().wsConnection === ws && get().authGeneration === generation;
    ws.onopen = () => { if (active()) set({wsStatus: "connected", wsRetryCount: 0}); else ws.close(); };
    ws.onmessage = event => {
      if (!active()) return;
      try { get()._handleWsMessage(JSON.parse(event.data)); }
      catch { console.error("[WS] Invalid message"); }
    };
    ws.onclose = () => {
      if (!active()) return;
      const retry = get().wsRetryCount;
      set({wsConnection: null, wsStatus: "disconnected", wsRetryCount: retry + 1});
      setTimeout(() => {
        if (get().authGeneration === generation && !get().wsConnection && get().backendPort === port) get().connectWebSocket(port);
      }, Math.min(3000 * 2 ** retry, 30000));
    };
    ws.onerror = () => { if (active()) ws.close(); };
  },
  sendWsMessage: (type, payload) => {
    const ws = get().wsConnection;
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({type, payload})); return true; }
    return false;
  },
});
