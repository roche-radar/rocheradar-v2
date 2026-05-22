import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Users, FileText, History, Settings, Bot, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/targets", icon: Users, label: "Targets" },
  { to: "/reports", icon: FileText, label: "Reports" },
  { to: "/history", icon: History, label: "Run History" },
  { to: "/agent", icon: Bot, label: "Hermes AI" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 h-full bg-roche-blue dark:bg-gray-900 text-white transition-all duration-200 z-40 flex flex-col",
        sidebarOpen ? "w-64" : "w-16"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">
          RR
        </div>
        {sidebarOpen && (
          <span className="font-semibold text-sm tracking-wide">RocheRadar</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-white/20 text-white font-medium"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )
            }
          >
            <Icon size={18} className="shrink-0" />
            {sidebarOpen && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="flex items-center justify-center p-4 text-white/60 hover:text-white border-t border-white/10"
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </aside>
  );
}
