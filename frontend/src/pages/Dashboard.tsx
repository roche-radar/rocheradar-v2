import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Play, Square, RefreshCw, TrendingUp, Users, FileText, Clock, BarChart2, ExternalLink } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { api, type Insight } from "@/lib/api";
import { formatDateTime, SENTIMENT_COLORS, cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const PERIOD_OPTIONS = [
  { label: "7 days",  value: 7  },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

const PIE_COLORS = ["#0066cc", "#e94560", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];
const ROCHE_BLUE = "#003087";

function StatCard({ label, value, icon: Icon, sub }: {
  label: string; value: string | number; icon: React.ElementType; sub?: string;
}) {
  return (
    <div className="bg-white dark:bg-[#111827] rounded-xl p-5 shadow-sm border border-gray-100 dark:border-[#1e3a5f]">
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
  const [period, setPeriod] = useState(7);

  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 10_000 });
  const { data: currentRun } = useQuery({
    queryKey: ["current-run"],
    queryFn: api.runs.current,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 10_000),
  });
  const { data: insights } = useQuery({ queryKey: ["latest-insights"], queryFn: () => api.reports.latest(15) });
  const { data: topics } = useQuery({
    queryKey: ["topics", period],
    queryFn: () => api.topics(period),
    refetchInterval: 30_000,
  });

  const triggerMut = useMutation({
    mutationFn: () => api.runs.trigger(),
    onSuccess: (d) => { setActiveRunId(d.run_id); qc.invalidateQueries({ queryKey: ["current-run"] }); },
  });
  const stopMut = useMutation({
    mutationFn: api.runs.stop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["current-run"] }),
  });

  const running = currentRun?.running;
  const progress = running && currentRun.total_targets
    ? Math.round(((currentRun.targets_processed ?? 0) / currentRun.total_targets) * 100)
    : 0;

  const hasTopics = topics && topics.total > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-roche-blue dark:text-[#e2e8f0]">Dashboard</h1>
        <div className="flex gap-2">
          {running ? (
            <button onClick={() => stopMut.mutate()}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              <Square size={14} /> Stop Run
            </button>
          ) : (
            <button onClick={() => triggerMut.mutate()} disabled={triggerMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-roche-blue text-white rounded-lg text-sm font-medium hover:bg-roche-light disabled:opacity-50">
              <Play size={14} /> Run Now
            </button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Targets" value={stats?.active_targets ?? "—"} icon={Users} />
        <StatCard label="Today's Insights" value={stats?.today_insights ?? "—"} icon={TrendingUp} />
        <StatCard label="Total Insights" value={stats?.total_insights ?? "—"} icon={FileText} />
        <StatCard label="Last Run" value={stats?.last_run_status ?? "Never"} icon={Clock}
          sub={stats?.last_run_at ? formatDateTime(stats.last_run_at) : undefined} />
      </div>

      {/* Active run progress */}
      {running && currentRun && (
        <div className="bg-white dark:bg-[#111827] rounded-xl p-5 shadow-sm border border-blue-100 dark:border-blue-900">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="animate-spin text-roche-light" />
              <span className="font-medium text-sm">
                Pipeline running — {currentRun.current_target ?? "initialising..."}
              </span>
            </div>
            <span className="text-sm text-gray-500">{currentRun.targets_processed}/{currentRun.total_targets} targets</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-[#1e2d4a] rounded-full h-2">
            <div className="bg-roche-light h-2 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span>{currentRun.new_posts_found} new posts</span>
            <span>{currentRun.insights_extracted} insights</span>
            <span>{currentRun.llm_calls_used} LLM calls</span>
          </div>
        </div>
      )}

      {/* Intelligence Analytics */}
      <div className="bg-white dark:bg-[#111827] rounded-xl shadow-sm border border-gray-100 dark:border-[#1e3a5f]">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-[#1e3a5f]">
          <div className="flex items-center gap-2">
            <BarChart2 size={18} className="text-roche-light" />
            <h2 className="font-semibold text-sm">Intelligence Analytics</h2>
          </div>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setPeriod(o.value)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-medium transition-colors",
                  period === o.value
                    ? "bg-roche-blue text-white"
                    : "text-gray-500 hover:text-roche-light"
                )}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {!hasTopics ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No insights yet — run the pipeline to populate analytics.
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Category bar chart */}
            <div className="lg:col-span-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Most Discussed Topics — last {period} days
                <span className="ml-2 text-roche-light font-bold">{topics.total} insights</span>
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topics.categories} layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v) => [`${v} insights`, ""]}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {topics.categories.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Sentiment pie */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sentiment</p>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={topics.sentiment} dataKey="count" nameKey="name"
                    cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    } labelLine={false}>
                    {topics.sentiment.map((entry) => (
                      <Cell key={entry.name}
                        fill={entry.name === "Positive" ? "#22c55e" : entry.name === "Negative" ? "#ef4444" : "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v} insights`, ""]} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Top KOLs bar */}
            {topics.top_kols.length > 0 && (
              <div className="lg:col-span-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Top KOLs by insights</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={topics.top_kols} layout="vertical"
                    margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v) => [`${v} insights`, ""]} />
                    <Bar dataKey="count" fill={ROCHE_BLUE} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top topics list */}
            {topics.top_topics.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Trending topics</p>
                <div className="space-y-2">
                  {topics.top_topics.slice(0, 8).map((t) => (
                    <div key={t.topic} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-700 dark:text-[#94a3b8] truncate">{t.topic}</div>
                        <div className="h-1.5 bg-gray-100 dark:bg-[#1e2d4a] rounded-full mt-1">
                          <div className="h-1.5 bg-roche-light rounded-full"
                            style={{ width: `${(t.count / topics.top_topics[0].count) * 100}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-roche-light shrink-0">{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent insights feed */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Findings</h2>
        <div className="space-y-3">
          {insights?.map((ins) => <InsightCard key={ins.id} insight={ins} />)}
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
  const sourceName = insight.source_name || (insight.source_url
    ? new URL(insight.source_url).hostname.replace("www.", "")
    : null);

  return (
    <div className="bg-white dark:bg-[#111827] rounded-xl p-4 shadow-sm border border-gray-100 dark:border-[#1e3a5f]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-roche-light">{insight.target_name}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-xs text-gray-400">{insight.category?.replace("_", " ")}</span>
          </div>
          <p className="font-medium text-sm mb-1">{insight.topic}</p>
          <p className="text-sm text-gray-600 dark:text-[#64748b] line-clamp-2">{insight.what_they_said}</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full shrink-0", SENTIMENT_COLORS[insight.sentiment] ?? SENTIMENT_COLORS.neutral)}>
          {insight.sentiment}
        </span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-400">{formatDateTime(insight.extracted_at)}</span>
        {insight.source_url && (
          <a
            href={insight.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-roche-light hover:text-roche-blue transition-colors"
            title={`Open source: ${sourceName}`}
          >
            <ExternalLink size={11} />
            {sourceName ? <span className="max-w-[160px] truncate">{sourceName}</span> : "Source"}
          </a>
        )}
      </div>
    </div>
  );
}
