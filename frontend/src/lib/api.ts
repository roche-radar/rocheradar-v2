// In dev: proxied to localhost:8009 via Vite
// In prod (Railway): VITE_API_URL=https://your-backend.railway.app
declare const __API_BASE__: string;
const BASE = (typeof __API_BASE__ !== "undefined" && __API_BASE__ ? __API_BASE__ : "") + "/api";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────
export interface Target {
  id: number;
  name: string;
  known_urls: string[];
  notes: string | null;
  active: boolean;
}

export interface RunOut {
  id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_targets: number;
  targets_processed: number;
  new_posts_found: number;
  insights_extracted: number;
  pdfs_generated: number;
  current_target: string | null;
  error_message: string | null;
  llm_calls_used: number;
}

export interface Stats {
  active_targets: number;
  total_insights: number;
  today_insights: number;
  last_run_at: string | null;
  last_run_status: string | null;
}

export interface Insight {
  id: number;
  target_name: string;
  topic: string;
  what_they_said: string;
  sentiment: string;
  category: string;
  extracted_at: string;
  source_url: string | null;
  source_name: string | null;
  published_date: string | null;
}

export interface AppSettings {
  llm_provider: string;
  llm_model: string;
  ollama_base_url: string;
  nvidia_base_url: string;
  custom_base_url: string | null;
  cron_hour: number;
  cron_minute: number;
  cron_enabled: boolean;
  cron_frequency: string;
  cron_day_of_week: number;
  agent_budget_per_run: number;
  llm_budget_hard_stop: number;
  available_providers: Record<string, string>;
}

export interface TopicsData {
  period_days: number;
  total: number;
  categories: { name: string; count: number }[];
  top_topics: { topic: string; count: number; url?: string | null }[];
  sentiment: { name: string; count: number }[];
  top_kols: { name: string; count: number }[];
}

// ── API calls ─────────────────────────────────────────────
export const api = {
  stats: () => req<Stats>("/stats"),
  topics: (days = 7) => req<TopicsData>(`/stats/topics?days=${days}`),

  targets: {
    list: () => req<Target[]>("/targets/"),
    create: (body: Partial<Target>) => req<Target>("/targets/", { method: "POST", body: JSON.stringify(body) }),
    update: (id: number, body: Partial<Target>) =>
      req<Target>(`/targets/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    deactivate: (id: number) => req<void>(`/targets/${id}`, { method: "DELETE" }),
  },

  runs: {
    list: () => req<RunOut[]>("/runs/"),
    current: () => req<{ running: boolean } & Partial<RunOut>>("/runs/current"),
    trigger: (limit?: number) =>
      req<{ run_id: number }>("/runs/trigger", { method: "POST", body: JSON.stringify({ limit }) }),
    stop: () => req<{ stopped: boolean }>("/runs/stop", { method: "POST" }),
    generatePdfs: () => req<{ status: string; run_id: number }>("/runs/generate-pdfs", { method: "POST" }),
    resetAll: () => req<{ db_cleared: boolean; blobs_deleted: number; chroma_reset: boolean }>("/runs/reset-all", { method: "POST" }),
  },

  reports: {
    latest: (limit = 20) => req<Insight[]>(`/reports/latest?limit=${limit}`),
    list: () => req<{ path: string; name: string; size: number; url: string; uploadedAt?: string }[]>("/reports/"),
  },

  settings: {
    get: () => req<AppSettings>("/settings/"),
    update: (body: Partial<AppSettings>) =>
      req<AppSettings>("/settings/", { method: "POST", body: JSON.stringify(body) }),
    fetchModels: (body: { provider?: string }) =>
      req<{ provider: string; models: string[] }>("/settings/models", { method: "POST", body: JSON.stringify(body) }),
    testConnection: (body: { provider?: string; model?: string }) =>
      req<{ ok: boolean }>("/settings/test-connection", { method: "POST", body: JSON.stringify(body) }),
  },

  agent: {
    chat: (message: string) =>
      req<{ reply: string }>("/agent/chat", { method: "POST", body: JSON.stringify({ message }) }),
    history: () => req<{ role: string; content: string; created_at: string }[]>("/agent/history"),
    clearHistory: () => req<void>("/agent/history", { method: "DELETE" }),
  },
};
