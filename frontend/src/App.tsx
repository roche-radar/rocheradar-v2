import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import Targets from "@/pages/Targets";
import Reports from "@/pages/Reports";
import RunHistory from "@/pages/RunHistory";
import SettingsPage from "@/pages/Settings";
import Agent from "@/pages/Agent";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";

export default function App() {
  const { sidebarOpen } = useAppStore();

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <Sidebar />
        <main
          className={cn(
            "flex-1 overflow-auto transition-all duration-200",
            sidebarOpen ? "ml-64" : "ml-16"
          )}
        >
          <div className="max-w-7xl mx-auto px-6 py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/targets" element={<Targets />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/history" element={<RunHistory />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/agent" element={<Agent />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}
