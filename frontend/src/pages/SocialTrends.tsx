import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Flame, Heart, MessageCircle, Eye, Share2, ExternalLink, X, Sparkles, Loader2, Search, RefreshCw } from "lucide-react";
import { api, type SocialPost } from "@/lib/api";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  { value: "all",       label: "All" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter",   label: "X / Twitter" },
  { value: "tiktok",    label: "TikTok" },
  { value: "facebook",  label: "Facebook" },
];

const PLATFORM_COLOR: Record<string, string> = {
  instagram: "bg-pink-100 text-pink-700 dark:bg-pink-900/20 dark:text-pink-300",
  twitter: "bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300",
  tiktok: "bg-slate-200 text-slate-800 dark:bg-slate-700/40 dark:text-slate-200",
  facebook: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function Stat({ icon: Icon, value }: { icon: React.ElementType; value: number }) {
  if (!value) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-[#94a3b8]">
      <Icon size={11} /> {fmt(value)}
    </span>
  );
}

export default function SocialTrends() {
  const [platform, setPlatform] = useState("all");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<SocialPost | null>(null);

  // Manual Apify search (specific topic)
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [searching, setSearching] = useState(false);
  const [polls, setPolls] = useState(0);

  const qc = useQueryClient();

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const apifyOn = !!settings?.apify_configured;

  const { data: trends } = useQuery({
    queryKey: ["social-trends", platform, kind],
    queryFn: () => api.social.trends(180, platform, kind, 60),
    refetchInterval: 60_000,
  });

  // Per-platform counts so filter chips show how many posts exist
  const { data: allTrends } = useQuery({
    queryKey: ["social-trends", "all", "all"],
    queryFn: () => api.social.trends(180, "all", "all", 200),
    staleTime: 60_000,
  });
  const countByPlatform = (allTrends?.top_posts ?? []).reduce<Record<string, number>>((acc, p) => {
    acc[p.platform] = (acc[p.platform] ?? 0) + 1;
    return acc;
  }, {});
  const { data: status } = useQuery({
    queryKey: ["social-status"],
    queryFn: api.social.status,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 30_000),
  });

  // Cached results for the manual search (re-keyed on polls to pick up fresh inserts)
  const { data: searchData } = useQuery({
    queryKey: ["social-search", submitted, polls],
    queryFn: () => api.social.discover(submitted, false),
    enabled: submitted.length > 1,
  });
  const searchMut = useMutation({
    mutationFn: () => api.social.discover(submitted, true),
    onSuccess: () => { setPolls(0); setSearching(true); },
  });
  useEffect(() => {
    if (!searching) return;
    if (polls >= 6) {
      setSearching(false);
      // Refresh the main trends grid so newly inserted posts appear
      qc.invalidateQueries({ queryKey: ["social-trends"] });
      return;
    }
    const t = setTimeout(() => setPolls(p => p + 1), 5000);
    return () => clearTimeout(t);
  }, [searching, polls]);

  function runSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setSubmitted(q);
    if (apifyOn) searchMut.mutate();
  }
  function clearSearch() { setSubmitted(""); setQuery(""); setSearching(false); setPolls(0); }

  const searchPosts = searchData?.results ?? [];
  const hasData = trends && trends.total > 0;

  return (
    <div className="glass rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6 pb-4 border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
            <Flame size={18} className="text-orange-500 shrink-0" />
          </div>
          <div>
            <h2 className="font-semibold text-sm whitespace-nowrap">Trending on Social</h2>
            <p className="text-[11px] text-gray-400">
              Instagram · X · TikTok · Facebook — last 6 months
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          {PLATFORMS.map((p) => {
            const count = p.value === "all"
              ? (allTrends?.total ?? 0)
              : (countByPlatform[p.value] ?? 0);
            const active = platform === p.value;
            return (
              <button key={p.value} onClick={() => setPlatform(p.value)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1",
                  active ? "bg-roche-blue text-white" : "text-gray-500 hover:text-roche-light"
                )}>
                {p.label}
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] rounded-full px-1 leading-4",
                    active ? "bg-white/20 text-white" : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400"
                  )}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Manual Apify search */}
      <div className="px-6 py-3 border-b border-slate-200/50 dark:border-slate-800/50 flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && runSearch()}
            placeholder="Search a topic, drug or competitor on social…"
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-gray-200 dark:border-[#1e3a5f] bg-gray-50 dark:bg-[#111827] text-sm text-gray-900 dark:text-[#e2e8f0] focus:outline-none focus:ring-2 focus:ring-orange-400/30" />
        </div>
        <button onClick={runSearch} disabled={query.trim().length < 2 || searching}
          title={apifyOn ? "Search via Apify across all platforms" : "Set APIFY_API_TOKEN to pull fresh results"}
          className="h-9 px-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg flex items-center gap-1.5 shrink-0">
          {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
          Search
        </button>
        {submitted && (
          <button onClick={clearSearch}
            className="h-9 px-3 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Clear</button>
        )}
      </div>

      {/* Scan status banner */}
      {status?.running && (
        <div className="flex items-center gap-2 px-6 py-2 text-xs text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-100 dark:border-blue-900/30">
          <Loader2 size={13} className="animate-spin" />
          Scanning social platforms… {status.done ?? 0}/{status.total ?? 0} jobs, {status.inserted ?? 0} posts found
        </div>
      )}

      {/* Manual search results */}
      {submitted && (
        <div className="p-5 border-b border-slate-200/50 dark:border-slate-800/50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Results for "{submitted}"
            {searching
              ? <span className="ml-2 text-orange-500 normal-case font-normal">pulling fresh posts…</span>
              : <span className="ml-2 text-gray-400 normal-case font-normal">{searchPosts.length} found</span>}
          </p>
          {searchPosts.length === 0 ? (
            <p className="text-sm text-gray-400">{searching ? "Searching across platforms…" : "No posts found yet — try a broader term."}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchPosts.map(p => <PostCard key={p.id} post={p} onClick={() => setSelected(p)} />)}
            </div>
          )}
        </div>
      )}

      {!hasData ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-gray-400 text-sm">
            {status?.running
              ? "Scan in progress — results will appear here shortly."
              : platform === "all" && kind === "all"
                ? "No social trends yet. Run a scan to populate this."
                : `No posts found for the active filter.`}
          </p>
          {(platform !== "all" || kind !== "all") && (
            <button
              onClick={() => { setPlatform("all"); setKind("all"); }}
              className="text-xs text-roche-light hover:text-roche-blue font-medium transition-colors"
            >
              ← Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Trending topics chips */}
          {trends.top_topics.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Trending topics</p>
              <div className="flex flex-wrap gap-2">
                {trends.top_topics.slice(0, 12).map((t) => (
                  <span key={t.topic}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-orange-50 dark:bg-orange-900/15 text-orange-700 dark:text-orange-300 border border-orange-100 dark:border-orange-900/30">
                    <span className="font-medium">{t.topic}</span>
                    <span className="text-orange-400">{t.count}</span>
                    <span className="text-[10px] text-orange-400">· {fmt(t.engagement)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Kind filter */}
          <div className="flex gap-1">
            {[["all", "All posts"], ["field", "Medical field"], ["kol", "KOLs"]].map(([v, l]) => (
              <button key={v} onClick={() => setKind(v)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                  kind === v ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900" : "text-gray-500 hover:text-roche-light"
                )}>
                {l}
              </button>
            ))}
          </div>

          {/* Post cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trends.top_posts.map((p) => <PostCard key={p.id} post={p} onClick={() => setSelected(p)} />)}
          </div>
        </div>
      )}

      {selected && <DescribeModal post={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function PostCard({ post: p, onClick }: { post: SocialPost; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className="glass-panel rounded-xl overflow-hidden cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col">
      {p.thumbnail_url && (
        <div className="h-32 bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <img src={p.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", PLATFORM_COLOR[p.platform] ?? "bg-gray-100 text-gray-600")}>
            {p.platform}
          </span>
          {p.topic && <span className="text-[10px] text-gray-400 truncate">#{p.topic}</span>}
        </div>
        {p.author && <p className="text-xs font-semibold text-roche-light truncate">{p.author}</p>}
        <p className="text-xs text-gray-600 dark:text-[#94a3b8] line-clamp-3 mt-1 flex-1">{p.text || "—"}</p>
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 dark:border-slate-800">
          <Stat icon={Heart} value={p.likes} />
          <Stat icon={MessageCircle} value={p.comments} />
          <Stat icon={Eye} value={p.views} />
          <Stat icon={Share2} value={p.shares} />
        </div>
      </div>
    </div>
  );
}

export function DescribeModal({ post, onClose }: { post: SocialPost; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["social-describe", post.id],
    queryFn: () => api.social.describe(post.id),
    staleTime: Infinity,
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-slate-800">
          <div className="min-w-0">
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", PLATFORM_COLOR[post.platform] ?? "bg-gray-100 text-gray-600")}>
              {post.platform}
            </span>
            {post.author && <p className="text-sm font-semibold text-roche-light mt-1.5 truncate">{post.author}</p>}
          </div>
          <button onClick={onClose} className="ml-4 text-gray-400 hover:text-gray-600 shrink-0"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {post.thumbnail_url && (
            <img src={post.thumbnail_url} alt="" className="w-full rounded-lg object-cover max-h-64"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}

          {/* LLM description */}
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" /> Analysing…</p>
          ) : isError ? (
            <p className="text-sm text-red-500">Couldn't generate a description.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  <Sparkles size={12} className="text-roche-light" /> What this is
                </p>
                <p className="text-sm text-gray-800 dark:text-[#e2e8f0] leading-relaxed">{data?.description}</p>
              </div>
              {data?.so_what && (
                <div className="rounded-lg bg-roche-blue/5 dark:bg-[#2563eb]/10 border border-roche-blue/20 dark:border-[#2563eb]/30 px-3 py-2.5">
                  <p className="text-xs font-semibold text-roche-blue dark:text-[#93c5fd] uppercase tracking-wide mb-1">
                    So what for pharma?
                  </p>
                  <p className="text-sm text-gray-800 dark:text-[#e2e8f0] leading-relaxed">{data.so_what}</p>
                </div>
              )}
            </div>
          )}

          {/* Post text */}
          {post.text && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Post</p>
              <p className="text-sm text-gray-600 dark:text-[#94a3b8] leading-relaxed whitespace-pre-wrap">{post.text}</p>
            </div>
          )}

          {/* Engagement */}
          <div className="flex items-center gap-4 pt-3 border-t border-gray-100 dark:border-slate-800">
            <Stat icon={Heart} value={post.likes} />
            <Stat icon={MessageCircle} value={post.comments} />
            <Stat icon={Eye} value={post.views} />
            <Stat icon={Share2} value={post.shares} />
          </div>

          {post.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {post.hashtags.slice(0, 12).map((h) => (
                <span key={h} className="text-[11px] text-gray-400">#{h}</span>
              ))}
            </div>
          )}

          <a href={post.post_url} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 border border-roche-light text-roche-light rounded-lg text-sm font-medium hover:bg-roche-light hover:text-white transition-colors">
            <ExternalLink size={14} /> View Original Post
          </a>
        </div>
      </div>
    </div>
  );
}
