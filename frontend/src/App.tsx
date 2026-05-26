import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import Targets from "@/pages/Targets";
import Reports from "@/pages/Reports";
import RunHistory from "@/pages/RunHistory";
import SettingsPage from "@/pages/Settings";
import Agent from "@/pages/Agent";
import TopicExplorer from "@/pages/TopicExplorer";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";
import AnimatedBackground from "@/components/AnimatedBackground";

function Padded({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-auto h-full">
      <div className="max-w-7xl mx-auto px-6 py-8">{children}</div>
    </div>
  );
}

export default function App() {
  const { sidebarOpen, darkMode } = useAppStore();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden text-slate-800 dark:text-slate-200">
        <AnimatedBackground />
        <Sidebar />
        <main className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-200",
          sidebarOpen ? "ml-64" : "ml-16"
        )}>
          <Routes>
            <Route path="/"          element={<Navigate to="/dashboard" replace />} />
            <Route path="/topics"    element={<TopicExplorer />} />
            <Route path="/dashboard" element={<Padded><Dashboard /></Padded>} />
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
