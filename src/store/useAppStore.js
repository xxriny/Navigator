import { create } from "zustand";
import { debounce } from "./debounce";
import { createUiSlice } from "./slices/uiSlice";
import { createFileSlice } from "./slices/fileSlice";
import { createPipelineSlice } from "./slices/pipelineSlice";
import { createSessionSlice } from "./slices/sessionSlice";
import { createWsSlice } from "./slices/wsSlice";
import { createConfigSlice } from "./slices/configSlice";
import { createNotificationSlice } from "./slices/notificationSlice";
import { createAuthSlice } from "./slices/authSlice";
import { createGithubSlice } from "./slices/githubSlice";
import { createPublishSlice } from './slices/publishSlice';
import { sessionService } from '../api/services/sessionService';
import { ownsLocalSession, persistSessions } from './storeHelpers';

/**
 * NAVIGATOR — Global Store (Zustand)
 * Slice Pattern을 사용하여 기능별로 모듈화됨.
 */
const useAppStore = create((set, get) => {
  const debouncedSave = debounce(() => get().saveCurrentSession(), 500);

  // 상태 변경 시마다 자동 저장 트리거
  const setWithSave = (partial, replace) => {
    set(partial, replace);
    debouncedSave();
  };

  return {
    ...createUiSlice(setWithSave, get),
    ...createFileSlice(setWithSave, get),
    ...createPipelineSlice(setWithSave, get),
    ...createSessionSlice(setWithSave, get),
    ...createWsSlice(setWithSave, get),
    ...createConfigSlice(setWithSave, get),
    ...createNotificationSlice(setWithSave, get),
    ...createAuthSlice(setWithSave, get),
    ...createGithubSlice(setWithSave, get),
    ...createPublishSlice(setWithSave, get),

    deleteSession: async (id) => {
      const context = get();
      const session = context.sessions.find(s => s.id === id);
      if (!ownsLocalSession(session, context.currentUser)) return;
      const runId = session.resultData?.run_id;
      if (runId) {
        try {
          const result = await sessionService.deleteSession(context.backendPort, runId, context.authToken);
          if (result.status !== "ok") throw new Error(result.error || "삭제하지 못했습니다.");
        } catch (error) {
          if (get().authGeneration === context.authGeneration) get().addNotification(`삭제 실패: ${error.message}`, "error");
          return;
        }
      }
      if (get().authGeneration !== context.authGeneration) return;
      if (get().currentSessionId === id) get().startNewProject?.();
      const nextSessions = get().sessions.filter(s => s.id !== id);
      persistSessions(nextSessions, context.currentUser);
      setWithSave({sessions: nextSessions, ...(get().currentSessionId === id ? {currentSessionId: null, serverSessionId: null, chatHistory: [], resultData: null} : {})});
    },
  };
});

export default useAppStore;
