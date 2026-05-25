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
        // Light: Roche blue  |  Dark: deep midnight sidebar
        "fixed top-0 left-0 h-full transition-all duration-200 z-40 flex flex-col",
        "bg-roche-blue dark:bg-[#070c19]",
        "text-white",
        "border-r border-transparent dark:border-[#1e3a5f]/50",
        sidebarOpen ? "w-64" : "w-16"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10 dark:border-[#1e3a5f]/60">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0",
          "bg-white/20 dark:bg-[#2563eb]/30 dark:text-[#93c5fd]"
        )}>
          RR
        </div>
        {sidebarOpen && (
          <div>
            <span className="font-bold text-sm tracking-wide block">RocheRadar</span>
            <span className="text-[10px] opacity-50 dark:opacity-40 font-normal">Pharma Intelligence</span>
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
                  ? "bg-white/20 dark:bg-[#2563eb]/20 text-white dark:text-[#93c5fd] font-semibold dark:border dark:border-[#2563eb]/30"
                  : "text-white/70 dark:text-[#94a3b8] hover:bg-white/10 dark:hover:bg-[#1e2d4a] hover:text-white dark:hover:text-[#e2e8f0]"
              )
            }
          >
            <Icon size={18} className="shrink-0" />
            {sidebarOpen && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="border-t border-white/10 dark:border-[#1e3a5f]/60">
        <button
          onClick={toggleDarkMode}
          className="w-full flex items-center gap-3 px-5 py-3 text-white/60 dark:text-[#94a3b8] hover:text-white dark:hover:text-[#f59e0b] hover:bg-white/10 dark:hover:bg-[#1e2d4a] transition-colors text-sm"
          aria-label="Toggle dark mode"
        >
          {darkMode
            ? <Sun size={16} className="shrink-0 text-[#f59e0b]" />
            : <Moon size={16} className="shrink-0" />}
          {sidebarOpen && <span>{darkMode ? "Light mode" : "Dark mode"}</span>}
        </button>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-full flex items-center justify-center p-4 text-white/60 dark:text-[#64748b] hover:text-white dark:hover:text-[#e2e8f0] border-t border-white/10 dark:border-[#1e3a5f]/60"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>
    </aside>
  );
}
