import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Play, Square, RefreshCw, TrendingUp, Users, FileText, Clock, BarChart2, ExternalLink, Filter, X } from "lucide-react";
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
  const [filterTarget, setFilterTarget] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSentiment, setFilterSentiment] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;
  const [drawerInsight, setDrawerInsight] = useState<Insight | null>(null);

  // Chart click → slide-over panel
  const [chartPanel, setChartPanel] = useState<{ label: string; type: "category"|"sentiment"|"kol"|"topic"; value: string } | null>(null);

  const { data: insights } = useQuery({ queryKey: ["latest-insights"], queryFn: () => api.reports.latest(100) });

  const chartPanelInsights = useMemo(() => {
    if (!chartPanel || !insights) return [];
    const { type, value } = chartPanel;
    const norm = (s: string) => s.toLowerCase().replace(/_/g, " ");
    return insights.filter(i => {
      if (type === "sentiment") return norm(i.sentiment || "") === norm(value);
      if (type === "category")  return norm(i.category  || "") === norm(value);
      if (type === "kol")       return i.target_name === value;
      if (type === "topic")     return norm(i.topic || "").includes(norm(value));
      return false;
    });
  }, [chartPanel, insights]);

  const targets = useMemo(() => [...new Set((insights ?? []).map(i => i.target_name))].sort(), [insights]);
  const categories = useMemo(() => [...new Set((insights ?? []).map(i => i.category).filter(Boolean))].sort(), [insights]);

  const oneYearAgo = useMemo(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10);
  }, []);

  const filtered = useMemo(() =>
    (insights ?? []).filter(i =>
      (!filterTarget || i.target_name === filterTarget) &&
      (!filterCategory || i.category === filterCategory) &&
      (!filterSentiment || i.sentiment === filterSentiment) &&
      (!i.published_date || i.published_date >= oneYearAgo)
    ),
    [insights, filterTarget, filterCategory, filterSentiment, oneYearAgo]
  );

  // Reset page when filters change — must be in useEffect, not useMemo
  useEffect(() => { setPage(0); }, [filterTarget, filterCategory, filterSentiment, oneYearAgo]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
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
    <>
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-3 border-b border-gray-100 dark:border-[#1e3a5f]">
          <div className="flex items-center gap-2">
            <BarChart2 size={18} className="text-roche-light shrink-0" />
            <h2 className="font-semibold text-sm whitespace-nowrap">Intelligence Analytics</h2>
          </div>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setPeriod(o.value)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
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
              {/* onMouseDown preventDefault stops the SVG getting focus (black border) */}
              <div onMouseDown={e => e.preventDefault()}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topics.categories} layout="vertical"
                    margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v) => [`${v} insights — click to view`, ""]} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer"
                      onClick={(data) => {
                        if (data?.name) setChartPanel({ label: data.name, type: "category", value: data.name });
                      }}>
                      {topics.categories.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sentiment pie */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sentiment</p>
              <div onMouseDown={e => e.preventDefault()}>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={topics.sentiment} dataKey="count" nameKey="name"
                      cx="50%" cy="50%" outerRadius={70}
                      cursor="pointer"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                      onClick={(entry) => {
                        if (entry?.name) setChartPanel({ label: entry.name, type: "sentiment", value: entry.name });
                      }}>
                      {topics.sentiment.map((entry) => (
                        <Cell key={entry.name}
                          fill={entry.name === "Positive" ? "#22c55e" : entry.name === "Negative" ? "#ef4444" : "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`${v} insights — click to view`, ""]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top KOLs bar */}
            {topics.top_kols.length > 0 && (
              <div className="lg:col-span-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Top KOLs by insights</p>
                <div onMouseDown={e => e.preventDefault()}>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={topics.top_kols} layout="vertical"
                      margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(v) => [`${v} insights — click to view`, ""]} />
                      <Bar dataKey="count" fill={ROCHE_BLUE} radius={[0, 4, 4, 0]} cursor="pointer"
                        onClick={(data) => {
                          if (data?.name) setChartPanel({ label: data.name, type: "kol", value: data.name });
                        }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Top topics list */}
            {topics.top_topics.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Trending topics</p>
                <div className="space-y-2">
                  {topics.top_topics.slice(0, 8).map((t) => (
                    <div key={t.topic}
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setChartPanel({ label: t.topic, type: "topic", value: t.topic })}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-700 dark:text-[#94a3b8] truncate group-hover:text-roche-light transition-colors" title={t.topic}>
                          {t.topic}
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-[#1e2d4a] rounded-full mt-1">
                          <div className="h-1.5 bg-roche-light rounded-full group-hover:bg-roche-blue transition-colors"
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
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold mr-1">Recent Findings</h2>
          <Filter size={13} className="text-gray-400 shrink-0" />

          {/* Target filter */}
          <select
            value={filterTarget}
            onChange={e => setFilterTarget(e.target.value)}
            className="text-xs border border-gray-200 dark:border-[#1e3a5f] rounded-lg px-2 py-1 bg-white dark:bg-[#111827] text-gray-600 dark:text-[#94a3b8]"
          >
            <option value="">All KOLs</option>
            {targets.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Category filter */}
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="text-xs border border-gray-200 dark:border-[#1e3a5f] rounded-lg px-2 py-1 bg-white dark:bg-[#111827] text-gray-600 dark:text-[#94a3b8]"
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c?.replace(/_/g, " ")}</option>)}
          </select>

          {/* Sentiment filter */}
          {["positive", "neutral", "negative"].map(s => (
            <button
              key={s}
              onClick={() => setFilterSentiment(f => f === s ? "" : s)}
              className={cn(
                "text-xs px-2 py-1 rounded-full border transition-colors",
                filterSentiment === s
                  ? SENTIMENT_COLORS[s] + " border-transparent font-medium"
                  : "border-gray-200 dark:border-[#1e3a5f] text-gray-500 hover:border-gray-300"
              )}
            >
              {s}
            </button>
          ))}

          {(filterTarget || filterCategory || filterSentiment) && (
            <button
              onClick={() => { setFilterTarget(""); setFilterCategory(""); setFilterSentiment(""); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              clear
            </button>
          )}
          {insights?.length ? (
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} / {insights.length}</span>
          ) : null}
        </div>

        <div className="space-y-3">
          {paginated.map((ins) => <InsightCard key={ins.id} insight={ins} onClick={() => setDrawerInsight(ins)} />)}
          {!filtered.length && (
            <div className="text-center py-12 text-gray-400">
              {insights?.length ? "No results match the filters." : "No insights yet — run the pipeline to collect data."}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-[#1e3a5f]/50">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-[#1e3a5f] rounded-lg text-gray-500 dark:text-[#94a3b8] hover:border-roche-light hover:text-roche-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-gray-400">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-[#1e3a5f] rounded-lg text-gray-500 dark:text-[#94a3b8] hover:border-roche-light hover:text-roche-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
    {/* Chart click → insight list panel */}
    {chartPanel && (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1 bg-black/30" onClick={() => setChartPanel(null)} />
        <div className="w-full max-w-lg bg-white dark:bg-[#111827] shadow-2xl flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#1e3a5f] shrink-0">
            <div>
              <p className="text-xs text-gray-400 dark:text-[#64748b] capitalize mb-0.5">{chartPanel.type === "kol" ? "KOL" : chartPanel.type}</p>
              <h2 className="font-bold text-gray-900 dark:text-[#e2e8f0] text-base leading-snug">{chartPanel.label}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{chartPanelInsights.length} insight{chartPanelInsights.length !== 1 ? "s" : ""}</p>
            </div>
            <button onClick={() => setChartPanel(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#1e3a5f]/30 transition-all">
              <X size={18} />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chartPanelInsights.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No insights found for this selection.</div>
            ) : (
              chartPanelInsights.map(ins => (
                <div key={ins.id}
                  onClick={() => { setDrawerInsight(ins); setChartPanel(null); }}
                  className="bg-gray-50 dark:bg-[#0a0f1e] rounded-xl p-4 border border-gray-100 dark:border-[#1e3a5f]/50 cursor-pointer hover:border-roche-light/40 hover:shadow-sm transition-all">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-semibold text-roche-light">{ins.target_name}</span>
                        {ins.category && <span className="text-xs text-gray-400 dark:text-[#64748b]">{ins.category.replace(/_/g," ")}</span>}
                      </div>
                      <p className="text-sm font-medium text-gray-800 dark:text-[#e2e8f0] leading-snug">{ins.topic}</p>
                    </div>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full shrink-0 font-medium border",
                      ins.sentiment === "positive" ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/30" :
                      ins.sentiment === "negative" ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30" :
                      "bg-gray-100 text-gray-600 border-gray-200 dark:bg-[#1e3a5f]/30 dark:text-[#94a3b8] dark:border-[#1e3a5f]"
                    )}>{ins.sentiment}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-[#64748b] line-clamp-2 leading-relaxed">{ins.what_they_said}</p>
                  {ins.published_date && (
                    <p className="text-xs text-gray-400 dark:text-[#475569] mt-2">{ins.published_date}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    )}

    {/* Insight Drawer */}
    {drawerInsight && (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1 bg-black/30" onClick={() => setDrawerInsight(null)} />
        <div className="w-full max-w-md bg-white dark:bg-[#111827] shadow-2xl flex flex-col h-full overflow-y-auto">
          {/* Drawer header */}
          <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-[#1e3a5f]">
            <div>
              <p className="text-xs font-medium text-roche-light mb-1">{drawerInsight.target_name}</p>
              <h2 className="font-semibold text-gray-900 dark:text-[#e2e8f0] text-base leading-snug">{drawerInsight.topic}</h2>
            </div>
            <button onClick={() => setDrawerInsight(null)} className="ml-4 text-gray-400 hover:text-gray-600 shrink-0">
              <X size={20} />
            </button>
          </div>

          {/* Drawer body */}
          <div className="p-5 space-y-5 flex-1">
            {/* Sentiment + category */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium", SENTIMENT_COLORS[drawerInsight.sentiment] ?? SENTIMENT_COLORS.neutral)}>
                {drawerInsight.sentiment}
              </span>
              {drawerInsight.category && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-[#1e3a5f]/40 text-gray-600 dark:text-[#94a3b8]">
                  {drawerInsight.category.replace(/_/g, " ")}
                </span>
              )}
            </div>

            {/* What they said */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">What they said</p>
              <p className="text-sm text-gray-800 dark:text-[#e2e8f0] leading-relaxed">{drawerInsight.what_they_said}</p>
            </div>

            {/* Context */}
            {drawerInsight.context && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Context</p>
                <p className="text-sm text-gray-600 dark:text-[#94a3b8] leading-relaxed">{drawerInsight.context}</p>
              </div>
            )}

            {/* Meta */}
            <div className="pt-3 border-t border-gray-100 dark:border-[#1e3a5f]/50 space-y-2">
              {drawerInsight.published_date && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Published</span>
                  <span className="text-gray-600 dark:text-[#94a3b8]">{drawerInsight.published_date}</span>
                </div>
              )}
              {drawerInsight.source_name && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Source</span>
                  <span className="text-gray-600 dark:text-[#94a3b8]">{drawerInsight.source_name}</span>
                </div>
              )}
            </div>

            {/* Source link */}
            {drawerInsight.source_url && (
              <a
                href={drawerInsight.source_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 border border-roche-light text-roche-light rounded-lg text-sm font-medium hover:bg-roche-light hover:text-white transition-colors"
              >
                <ExternalLink size={14} /> View Original Post
              </a>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function InsightCard({ insight, onClick }: { insight: Insight; onClick: () => void }) {

  const sourceName = insight.source_name || (insight.source_url
    ? new URL(insight.source_url).hostname.replace("www.", "")
    : null);
  const today = new Date().toISOString().slice(0, 10);
  const displayDate = insight.published_date && insight.published_date <= today
    ? insight.published_date
    : formatDateTime(insight.extracted_at);

  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-[#111827] rounded-xl p-4 shadow-sm border border-gray-100 dark:border-[#1e3a5f] cursor-pointer hover:border-roche-light/40 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-roche-light">{insight.target_name}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-xs text-gray-400">{insight.category?.replace(/_/g, " ")}</span>
          </div>
          <p className="font-medium text-sm mb-1">{insight.topic}</p>
          <p className="text-sm text-gray-600 dark:text-[#64748b] line-clamp-2">{insight.what_they_said}</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full shrink-0", SENTIMENT_COLORS[insight.sentiment] ?? SENTIMENT_COLORS.neutral)}>
          {insight.sentiment}
        </span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-400">{displayDate}</span>
        {insight.source_url && (
          <a
            href={insight.source_url}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
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
