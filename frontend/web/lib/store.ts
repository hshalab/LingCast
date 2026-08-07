import { create } from 'zustand'

/** 1v1 会话状态：当前数字人与场景（后续接入直播/支付流程）。 */
type SessionState = {
  avatarId: number | null
  sceneId: number | null
  setSession: (avatarId: number, sceneId?: number) => void
  clear: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  avatarId: null,
  sceneId: null,
  setSession: (avatarId, sceneId) =>
    set({ avatarId, sceneId: sceneId ?? null }),
  clear: () => set({ avatarId: null, sceneId: null }),
}))
