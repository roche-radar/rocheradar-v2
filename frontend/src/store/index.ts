import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  sidebarOpen: boolean;
  mobileMenuOpen: boolean;
  activeRunId: number | null;
  darkMode: boolean;
  setSidebarOpen: (v: boolean) => void;
  setMobileMenuOpen: (v: boolean) => void;
  setActiveRunId: (id: number | null) => void;
  toggleDarkMode: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      mobileMenuOpen: false,
      activeRunId: null,
      darkMode: false,
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      setMobileMenuOpen: (v) => set({ mobileMenuOpen: v }),
      setActiveRunId: (id) => set({ activeRunId: id }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    }),
    { name: "rocheradar-ui" }
  )
);
