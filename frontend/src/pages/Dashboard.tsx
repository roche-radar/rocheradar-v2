import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Square, RefreshCw, TrendingUp, Users, FileText, Clock } from "lucide-react";
import { api, type Insight } from "@/lib/api";
import { formatDateTime, SENTIMENT_COLORS, cn } from "@/lib/utils";
import { useAppStore } from "@/store";

function StatCard({ label, value, icon: Icon, sub }: {
  label: string; value: string | number; icon: React.ElementType; sub?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500">{label}</span>
        <Icon size={18} className="text-roche-light" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { setActiveRunId } = useAppStore();

  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 10_000 });
  const { data: currentRun } = useQuery({
    queryKey: ["current-run"],
    queryFn: api.runs.current,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 10_000),
  });
  const { data: insights } = useQuery({ queryKey: ["latest-insights"], queryFn: () => api.reports.latest(15) });

  const triggerMut = useMutation({
    mutationFn: () => api.runs.trigger(),
    onSuccess: (d) => {
      setActiveRunId(d.run_id);
      qc.invalidateQueries({ queryKey: ["current-run"] });
    },
  });
  const stopMut = useMutation({
    mutationFn: api.runs.stop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["current-run"] }),
  });

  const running = currentRun?.running;
  const progress = running && currentRun.total_targets
    ? Math.round(((currentRun.targets_processed ?? 0) / currentRun.total_targets) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-roche-blue dark:text-white">Dashboard</h1>
        <div className="flex gap-2">
          {running ? (
            <button
              onClick={() => stopMut.mutate()}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
            >
              <Square size={14} /> Stop Run
            </button>
          ) : (
            <button
              onClick={() => triggerMut.mutate()}
              disabled={triggerMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-roche-blue text-white rounded-lg text-sm font-medium hover:bg-roche-light disabled:opacity-50"
            >
              <Play size={14} /> Run Now
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Targets" value={stats?.active_targets ?? "—"} icon={Users} />
        <StatCard label="Today's Insights" value={stats?.today_insights ?? "—"} icon={TrendingUp} />
        <StatCard label="Total Insights" value={stats?.total_insights ?? "—"} icon={FileText} />
        <StatCard
          label="Last Run"
          value={stats?.last_run_status ?? "Never"}
          icon={Clock}
          sub={stats?.last_run_at ? formatDateTime(stats.last_run_at) : undefined}
        />
      </div>

      {/* Active run progress */}
      {running && currentRun && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-blue-100 dark:border-blue-900">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="animate-spin text-roche-light" />
              <span className="font-medium text-sm">
                Pipeline running — {currentRun.current_target ?? "initialising..."}
              </span>
            </div>
            <span className="text-sm text-gray-500">
              {currentRun.targets_processed}/{currentRun.total_targets} targets
            </span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-roche-light h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span>{currentRun.new_posts_found} new posts</span>
            <span>{currentRun.insights_extracted} insights</span>
            <span>{currentRun.llm_calls_used} LLM calls</span>
          </div>
        </div>
      )}

      {/* Recent insights feed */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Findings</h2>
        <div className="space-y-3">
          {insights?.map((ins) => (
            <InsightCard key={ins.id} insight={ins} />
          ))}
          {!insights?.length && (
            <div className="text-center py-12 text-gray-400">
              No insights yet — run the pipeline to collect data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-roche-light">{insight.target_name}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-xs text-gray-400">{insight.category}</span>
          </div>
          <p className="font-medium text-sm mb-1">{insight.topic}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{insight.what_they_said}</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full shrink-0", SENTIMENT_COLORS[insight.sentiment] ?? SENTIMENT_COLORS.neutral)}>
          {insight.sentiment}
        </span>
      </div>
      <div className="text-xs text-gray-400 mt-2">{formatDateTime(insight.extracted_at)}</div>
    </div>
  );
}
