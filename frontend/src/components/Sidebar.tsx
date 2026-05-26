import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Users, FileText, History, Settings, Bot, Compass,
  ChevronLeft, ChevronRight, Sun, Moon,
} from "lucide-react";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard"      },
  { to: "/targets",   icon: Users,           label: "Targets"        },
  { to: "/reports",   icon: FileText,        label: "Reports"        },
  { to: "/topics",    icon: Compass,         label: "Topic Explorer" },
  { to: "/history",   icon: History,         label: "Run History"    },
  { to: "/agent",     icon: Bot,             label: "MedoAI"         },
  { to: "/settings",  icon: Settings,        label: "Settings"       },
];

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen, darkMode, toggleDarkMode } = useAppStore();

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 h-full transition-all duration-200 z-40 flex flex-col",
        "glass-panel rounded-r-2xl border-y-0 border-l-0 shadow-[4px_0_24px_-8px_rgba(0,0,0,0.1)]",
        "text-slate-800 dark:text-white",
        sidebarOpen ? "w-64" : "w-16"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-200/50 dark:border-white/10">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0",
          "bg-blue-100 text-blue-700 dark:bg-[#2563eb]/30 dark:text-[#93c5fd] shadow-sm"
        )}>
          RR
        </div>
        {sidebarOpen && (
          <div>
            <span className="font-bold text-sm tracking-wide block text-slate-800 dark:text-white">RocheRadar</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Pharma Intelligence</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-0.5 px-2">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150",
                isActive
                  ? "bg-blue-50 text-blue-700 dark:bg-[#2563eb]/20 dark:text-[#93c5fd] font-semibold shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/5 dark:hover:text-white"
              )
            }
          >
            <Icon size={18} className="shrink-0" />
            {sidebarOpen && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="border-t border-slate-200/50 dark:border-white/10">
        <button
          onClick={toggleDarkMode}
          className="w-full flex items-center gap-3 px-5 py-3 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-amber-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-sm"
          aria-label="Toggle dark mode"
        >
          {darkMode
            ? <Sun size={16} className="shrink-0 text-amber-500" />
            : <Moon size={16} className="shrink-0" />}
          {sidebarOpen && <span>{darkMode ? "Light mode" : "Dark mode"}</span>}
        </button>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-full flex items-center justify-center p-4 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border-t border-slate-200/50 dark:border-white/10"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>
    </aside>
  );
}
