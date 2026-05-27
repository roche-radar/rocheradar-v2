import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flame, Play, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import SocialTrends from "./SocialTrends";

export default function SocialPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const { data: status } = useQuery({
    queryKey: ["social-status"],
    queryFn: api.social.status,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 30000),
  });
  const scanMut = useMutation({
    mutationFn: api.social.scan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social-status"] }),
  });

  const apifyOff = settings && !settings.apify_configured;
  const running = status?.running;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
            <Flame size={22} className="text-orange-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-roche-blue dark:text-[#e2e8f0]">Social Trends</h1>
            <p className="text-sm text-gray-500 dark:text-[#94a3b8]">
              What's trending across Instagram, X, TikTok & Facebook for medical / Roche topics.
            </p>
          </div>
        </div>
        <button onClick={() => scanMut.mutate()} disabled={apifyOff || running || scanMut.isPending}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
            "bg-orange-500 text-white hover:bg-orange-600"
          )}>
          {running
            ? <><Loader2 size={14} className="animate-spin" /> Scanning…</>
            : <><Play size={14} /> Run Scan</>}
        </button>
      </div>

      {apifyOff && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg px-3 py-2.5">
          Apify isn't configured — set <code className="font-mono">APIFY_API_TOKEN</code> in <code className="font-mono">.env</code> to enable scanning. Configure keywords & platforms in Settings.
        </div>
      )}

      <SocialTrends />
    </div>
  );
}
