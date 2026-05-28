import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Play, Square, RefreshCw, TrendingUp, Users, FileText, Clock, BarChart2, ExternalLink, Filter, X, Sparkles, Loader2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { api, type Insight, type DailyBriefPoint } from "@/lib/api";
import { formatDateTime, SENTIMENT_COLORS, cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import SocialTrendsSummary from "./SocialTrendsSummary";

const PIE_COLORS = ["#0066cc", "#0ea5e9", "#14b8a6", "#f59e0b", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e"];
const ROCHE_BLUE = "#0066cc";

const PERIOD_OPTIONS = [
  { label: "7 days",  value: 7  },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function StatCard({ label, value, icon: Icon, sub }: {
  label: string; value: string | number; icon: React.ElementType; sub?: string;
}) {
  return (
    <div className="glass rounded-xl p-5 relative overflow-hidden group">
      <div className="flex items-center justify-between mb-3 relative">
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <Icon size={18} className="text-blue-600 dark:text-blue-400" />
        </div>
      </div>
      <div className="text-3xl font-bold text-slate-800 dark:text-slate-100 relative">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-2 relative">{sub}</div>}
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
  const [diseaseFilter, setDiseaseFilter] = useState<string>("all");
  const { data: topics } = useQuery({
    queryKey: ["topics", period, diseaseFilter],
    queryFn: () => api.topics(period, diseaseFilter),
    refetchInterval: 30_000,
  });
  const { data: allTargets } = useQuery({ queryKey: ["targets"], queryFn: api.targets.list });
  const diseaseAreas = useMemo(() => {
    const areas = [...new Set((allTargets || []).map(t => t.disease_area).filter(Boolean))] as string[];
    return areas;
  }, [allTargets]);

  const { data: brief, isLoading: briefLoading } = useQuery({
    queryKey: ["daily-brief"],
    queryFn: () => api.dailyBrief(),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  const briefMut = useMutation({
    mutationFn: () => api.dailyBrief(true),
    onSuccess: (data) => qc.setQueryData(["daily-brief"], data),
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Active Targets" value={stats?.active_targets ?? "—"} icon={Users} />
        <StatCard label="Today's Insights" value={stats?.today_insights ?? "—"} icon={TrendingUp} />
        <StatCard label="Total Insights" value={stats?.total_insights ?? "—"} icon={FileText} />
        <StatCard label="Last Run" value={stats?.last_run_status ?? "Never"} icon={Clock}
          sub={stats?.last_run_at ? formatDateTime(stats.last_run_at) : undefined} />
      </div>

      {/* Active run progress */}
      {running && currentRun && (
        <div className="glass-panel rounded-xl p-5 border border-blue-200 dark:border-blue-900/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="animate-spin text-blue-500" />
              <span className="font-medium text-sm text-blue-900 dark:text-blue-100">
                Pipeline running — {currentRun.current_target ?? "initialising..."}
              </span>
            </div>
            <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">{currentRun.targets_processed}/{currentRun.total_targets} targets</span>
          </div>
          <div className="w-full bg-slate-200/50 dark:bg-slate-800/50 rounded-full h-2 overflow-hidden shadow-inner">
            <div className="bg-gradient-to-r from-blue-400 to-indigo-500 h-2 rounded-full transition-all duration-500 relative" style={{ width: `${progress}%` }}>
              <div className="absolute inset-0 bg-white/20 animate-pulse" />
            </div>
          </div>
          <div className="flex gap-4 mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{currentRun.new_posts_found} new posts</span>
            <span>{currentRun.insights_extracted} insights</span>
            <span>{currentRun.llm_calls_used} LLM calls</span>
          </div>
        </div>
      )}

      {/* Daily Brief */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              <Sparkles size={16} className="text-amber-600 dark:text-amber-400"/>
            </div>
            <div>
              <h2 className="font-semibold text-sm">Today's Intelligence Brief</h2>
              <p className="text-xs text-gray-400">AI-generated key takeaways from KOL monitoring + social trends</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {brief && brief.kol_count > 0 && (
              <span className="text-[10px] text-gray-400">{brief.kol_count} insights · {brief.social_count} posts</span>
            )}
            <button onClick={() => briefMut.mutate()} disabled={briefMut.isPending || briefLoading}
              title="Regenerate brief from latest DB data"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-amber-300 dark:border-amber-800 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 transition-colors">
              {briefMut.isPending ? <Loader2 size={11} className="animate-spin"/> : <RefreshCw size={11}/>}
              Generate
            </button>
          </div>
        </div>
        {briefLoading || briefMut.isPending ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin"/>Generating brief…
          </div>
        ) : brief && brief.points.length > 0 ? (
          <div className="space-y-2">
            {brief.points.map((p: DailyBriefPoint, i: number) => (
              <div key={i} className={cn(
                "flex items-start gap-3 p-3 rounded-xl border",
                p.priority === "high"
                  ? "bg-amber-50/60 dark:bg-amber-900/10 border-amber-200/60 dark:border-amber-800/20"
                  : "bg-gray-50/60 dark:bg-[#0d1424]/40 border-slate-200/50 dark:border-white/5"
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                  p.priority === "high" ? "bg-amber-500" : "bg-gray-300 dark:bg-slate-600")}/>
                <div className="flex-1">
                  <p className="text-sm text-gray-700 dark:text-[#e2e8f0]">{p.text}</p>
                  <span className={cn("text-[10px] font-semibold mt-0.5 inline-block",
                    p.source === "kol" ? "text-blue-500" : p.source === "social" ? "text-orange-500" : "text-purple-500")}>
                    {p.source === "kol" ? "KOL insight" : p.source === "social" ? "Social trend" : "KOL + Social"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : brief?.error ? (
          <p className="text-xs text-red-400">LLM error: {brief.error}</p>
        ) : (
          <p className="text-sm text-gray-400">
            {brief && (brief.kol_count > 0 || brief.social_count > 0)
              ? "Click Generate to create the brief from existing data."
              : "No data yet — run a pipeline first, then click Generate."}
          </p>
        )}
      </div>

      {/* Intelligence Analytics */}
      <div className="glass rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6 pb-4 border-b border-slate-200/50 dark:border-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
              <BarChart2 size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
            </div>
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
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={topics.categories} layout="vertical"
                    margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderRadius: '8px', border: 'none', color: '#f1f5f9', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                      itemStyle={{ color: '#e2e8f0' }}
                      formatter={(v) => [`${v} insights`, ""]} 
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer"
                      onClick={(data) => {
                        if (data?.name) setChartPanel({ label: data.name, type: "category", value: data.name });
                      }}
                      animationDuration={1000}
                    >
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
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={topics.sentiment} dataKey="count" nameKey="name"
                      cx="50%" cy="50%" innerRadius={55} outerRadius={75}
                      cursor="pointer"
                      paddingAngle={3}
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                      animationDuration={1000}
                      onClick={(entry) => {
                        if (entry?.name) setChartPanel({ label: entry.name, type: "sentiment", value: entry.name });
                      }}>
                      {topics.sentiment.map((entry) => (
                        <Cell key={entry.name}
                          fill={entry.name === "Positive" ? "#22c55e" : entry.name === "Negative" ? "#ef4444" : "#94a3b8"} 
                          stroke="none"
                        />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderRadius: '12px', border: 'none', color: '#f1f5f9' }}
                      formatter={(v) => [`${v} insights — click to view`, ""]} 
                    />
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
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderRadius: '8px', border: 'none', color: '#f1f5f9' }}
                        formatter={(v) => [`${v} insights`, ""]} 
                      />
                      <Bar dataKey="count" fill={ROCHE_BLUE} radius={[0, 4, 4, 0]} cursor="pointer"
                        animationDuration={1000}
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
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Trending topics</p>
                  {diseaseAreas.length > 0 && (
                    <select
                      value={diseaseFilter}
                      onChange={e => setDiseaseFilter(e.target.value)}
                      className="text-xs border border-gray-200 dark:border-[#1e3a5f] rounded px-2 py-0.5 bg-transparent text-gray-600 dark:text-[#94a3b8]"
                    >
                      <option value="all">All areas</option>
                      {diseaseAreas.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  {topics.top_topics.slice(0, 8).map((t) => {
                    const maxScore = topics.top_topics[0].trend_score || 1;
                    const barWidth = Math.max(4, (t.trend_score / maxScore) * 100);
                    return (
                      <div key={t.topic}
                        className="flex items-center gap-2 cursor-pointer group"
                        onClick={() => setChartPanel({ label: t.topic, type: "topic", value: t.topic })}>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-700 dark:text-[#94a3b8] truncate group-hover:text-roche-light transition-colors" title={t.topic}>
                            {t.topic}
                          </div>
                          <div className="h-1.5 bg-gray-100 dark:bg-[#1e2d4a] rounded-full mt-1">
                            <div className="h-1.5 bg-roche-light rounded-full group-hover:bg-roche-blue transition-colors"
                              style={{ width: `${barWidth}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {t.likes > 0 && <span className="text-[10px] text-gray-400">♥{t.likes > 999 ? `${(t.likes/1000).toFixed(1)}k` : t.likes}</span>}
                          <span className="text-xs font-semibold text-roche-light">{t.count}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Social trending analytics (compact) → full page at /social */}
      <SocialTrendsSummary />

      {/* Recent insights feed */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold mr-1">Recent Findings</h2>
          <Filter size={13} className="text-gray-400 shrink-0" />

          {/* Target filter */}
          <select
            value={filterTarget}
            onChange={e => setFilterTarget(e.target.value)}
            className="text-xs border border-gray-200 dark:border-slate-800 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-gray-600 dark:text-[#94a3b8]"
          >
            <option value="">All KOLs</option>
            {targets.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Category filter */}
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="text-xs border border-gray-200 dark:border-slate-800 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-gray-600 dark:text-[#94a3b8]"
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
        <div className="w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
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
                  className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-100 dark:border-slate-700/50 cursor-pointer hover:border-roche-light/40 hover:shadow-sm transition-all">
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
        <div className="w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full overflow-y-auto">
          {/* Drawer header */}
          <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-slate-800">
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
      className="glass-panel rounded-xl p-5 cursor-pointer hover:bg-white/60 dark:hover:bg-slate-800/60 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
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
