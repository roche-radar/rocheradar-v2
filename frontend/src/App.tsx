import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Menu } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import Targets from "@/pages/Targets";
import Reports from "@/pages/Reports";
import RunHistory from "@/pages/RunHistory";
import SettingsPage from "@/pages/Settings";
import Agent from "@/pages/Agent";
import TopicExplorer from "@/pages/TopicExplorer";
import SocialPage from "@/pages/Social";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";
import AnimatedBackground from "@/components/AnimatedBackground";

function Padded({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-auto h-full">
      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-8">{children}</div>
    </div>
  );
}

export default function App() {
  const { sidebarOpen, darkMode, setMobileMenuOpen } = useAppStore();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden text-slate-800 dark:text-slate-200">
        <AnimatedBackground />

        {/* Mobile top bar */}
        <div className="lg:hidden fixed top-0 left-0 right-0 h-12 z-20 flex items-center gap-3 px-4 glass-panel border-b border-slate-200/50 dark:border-white/10">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-100 text-blue-700 dark:bg-[#2563eb]/30 dark:text-[#93c5fd] flex items-center justify-center text-[10px] font-bold">
              RR
            </div>
            <span className="font-bold text-sm text-slate-800 dark:text-white">RocheRadar</span>
          </div>
        </div>

        <Sidebar />

        <main className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-200",
          // Mobile: no sidebar offset, push content below topbar
          "mt-12 ml-0",
          // Desktop: sidebar offset, no topbar
          "lg:mt-0",
          sidebarOpen ? "lg:ml-64" : "lg:ml-16"
        )}>
          <Routes>
            <Route path="/"          element={<Navigate to="/dashboard" replace />} />
            <Route path="/topics"    element={<TopicExplorer />} />
            <Route path="/dashboard" element={<Padded><Dashboard /></Padded>} />
            <Route path="/social"    element={<SocialPage />} />
            <Route path="/targets"   element={<Padded><Targets /></Padded>} />
            <Route path="/reports"   element={<Padded><Reports /></Padded>} />
            <Route path="/history"   element={<Padded><RunHistory /></Padded>} />
            <Route path="/settings"  element={<Padded><SettingsPage /></Padded>} />
            <Route path="/agent"     element={<Padded><Agent /></Padded>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
