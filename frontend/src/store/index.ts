import { create } from "zustand";

interface AppState {
  sidebarOpen: boolean;
  activeRunId: number | null;
  setSidebarOpen: (v: boolean) => void;
  setActiveRunId: (id: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  activeRunId: null,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setActiveRunId: (id) => set({ activeRunId: id }),
}));
