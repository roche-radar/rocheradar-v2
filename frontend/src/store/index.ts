import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  sidebarOpen: boolean;
  activeRunId: number | null;
  darkMode: boolean;
  setSidebarOpen: (v: boolean) => void;
  setActiveRunId: (id: number | null) => void;
  toggleDarkMode: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      activeRunId: null,
      darkMode: false,
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      setActiveRunId: (id) => set({ activeRunId: id }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    }),
    { name: "rocheradar-ui" }
  )
);
