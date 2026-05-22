import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Save, RefreshCw, CheckCircle, XCircle, ChevronDown,
  Cpu, Calendar, Gauge, Info,
} from "lucide-react";
import { api, type AppSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

const PROVIDER_NOTES: Record<string, string> = {
  vertex:     "GCP service account / ADC. Set GOOGLE_APPLICATION_CREDENTIALS in .env",
  openrouter: "200+ models. Set OPENROUTER_API_KEY in .env",
  ollama:     "Local inference. Make sure Ollama is running.",
  nvidia:     "NVIDIA NIM cloud. Set NVIDIA_API_KEY in .env",
  anthropic:  "Claude models. Set ANTHROPIC_API_KEY in .env",
  openai:     "GPT models. Set OPENAI_API_KEY in .env",
  gemini:     "Gemini via AI Studio. Set GEMINI_API_KEY in .env",
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const [form, setForm] = useState<Partial<AppSettings>>({});
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [testState, setTestState] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => { if (settings) setForm({ ...settings }); }, [settings]);

  const updateMut = useMutation({
    mutationFn: () => api.settings.update(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    },
    onError: () => { setSaveState("error"); setTimeout(() => setSaveState("idle"), 2500); },
  });

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  async function fetchModels() {
    setModelsLoading(true); setModels([]);
    try { const r = await api.settings.fetchModels({ provider: form.llm_provider }); setModels(r.models); }
    catch { setModels([]); }
    setModelsLoading(false);
  }

  async function testConnection() {
    setTestState("loading"); setTestError("");
    try {
      await api.settings.testConnection({ provider: form.llm_provider, model: form.llm_pro_model });
      setTestState("ok");
    } catch (e: unknown) {
      setTestState("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    }
    setTimeout(() => setTestState("idle"), 6000);
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-24 text-gray-400">
      <RefreshCw size={20} className="animate-spin mr-2" /> Loading settings…
    </div>
  );

  const provider = form.llm_provider || "gemini";
  const frequency = form.cron_frequency ?? "weekly";

  return (
    <div className="max-w-5xl space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-roche-blue dark:text-[#e2e8f0]">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-[#94a3b8] mt-1">
          Configure the pipeline, LLM provider, and schedule.
        </p>
      </div>

      {/* ── 2-column grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── LEFT: LLM Provider ── */}
        <Card icon={<Cpu size={16} />} title="LLM Provider" subtitle="Model used for extraction and summaries">

          {/* Key reminder */}
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400
            bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40
            rounded-lg px-3 py-2.5">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>API keys live in <code className="font-mono">.env</code> — never stored in the database.</span>
          </div>

          {/* Provider select */}
          <Field label="Provider">
            <div className="relative">
              <select
                value={provider}
                onChange={e => { set("llm_provider", e.target.value); setModels([]); setTestState("idle"); }}
                className={input}
              >
                {Object.entries(settings?.available_providers ?? {}).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" />
            </div>
            {PROVIDER_NOTES[provider] && (
              <p className="text-xs text-gray-400 dark:text-[#64748b] mt-1">{PROVIDER_NOTES[provider]}</p>
            )}
          </Field>

          {/* Conditional URL fields */}
          {provider === "ollama" && (
            <Field label="Ollama Base URL">
              <input value={form.ollama_base_url ?? "http://localhost:11434"}
                onChange={e => set("ollama_base_url", e.target.value)} className={`${input} font-mono`} />
            </Field>
          )}
          {provider === "nvidia" && (
            <Field label="NVIDIA NIM Base URL">
              <input value={form.nvidia_base_url ?? "https://integrate.api.nvidia.com/v1"}
                onChange={e => set("nvidia_base_url", e.target.value)} className={`${input} font-mono`} />
            </Field>
          )}
          {provider === "openai" && (
            <Field label="Custom Base URL (optional)">
              <input value={form.custom_base_url ?? ""} placeholder="https://your-endpoint/v1"
                onChange={e => set("custom_base_url", e.target.value)} className={`${input} font-mono`} />
            </Field>
          )}

          {/* Fetch models */}
          <div className="flex items-center gap-3">
            <button onClick={fetchModels} disabled={modelsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200
                dark:border-[#1e3a5f] rounded-lg text-gray-500 dark:text-[#94a3b8]
                hover:border-roche-light hover:text-roche-light transition-colors disabled:opacity-50">
              <RefreshCw size={12} className={modelsLoading ? "animate-spin" : ""} />
              {modelsLoading ? "Fetching…" : "Fetch models"}
            </button>
            {models.length > 0 && (
              <span className="text-xs text-green-500 font-medium">{models.length} available</span>
            )}
          </div>

          <ModelField label="Pro model" value={form.llm_pro_model ?? ""} onChange={v => set("llm_pro_model", v)} suggestions={models} />
          <ModelField label="Flash model" value={form.llm_flash_model ?? ""} onChange={v => set("llm_flash_model", v)} suggestions={models} />

          {/* Test connection */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-[#1e3a5f]/50">
            <button onClick={testConnection} disabled={testState === "loading"}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
                testState === "ok"   ? "bg-green-50 dark:bg-green-900/20 text-green-600 border border-green-200 dark:border-green-800/40" :
                testState === "fail" ? "bg-red-50 dark:bg-red-900/20 text-red-600 border border-red-200 dark:border-red-800/40" :
                "border border-roche-light text-roche-light hover:bg-roche-light hover:text-white"
              )}>
              {testState === "loading" ? <><RefreshCw size={13} className="animate-spin" /> Testing…</> :
               testState === "ok"      ? <><CheckCircle size={13} /> Connected</> :
               testState === "fail"    ? <><XCircle size={13} /> Failed</> :
               "Test connection"}
            </button>
            {testError && (
              <p className="text-xs text-red-500 truncate max-w-[200px]" title={testError}>{testError}</p>
            )}
          </div>
        </Card>

        {/* ── RIGHT COLUMN: Schedule + Budget stacked ── */}
        <div className="space-y-6">

          {/* Schedule */}
          <Card icon={<Calendar size={16} />} title="Run Schedule" subtitle="When the pipeline runs automatically">

            {/* Frequency toggle */}
            <Field label="Frequency">
              <div className="grid grid-cols-2 gap-2">
                {(["weekly", "daily"] as const).map(f => (
                  <button key={f} type="button" onClick={() => set("cron_frequency", f)}
                    className={cn(
                      "py-2 rounded-lg text-sm font-medium border transition-colors",
                      frequency === f
                        ? "bg-roche-blue text-white border-roche-blue dark:bg-[#2563eb] dark:border-[#2563eb]"
                        : "border-gray-200 dark:border-[#1e3a5f] text-gray-500 dark:text-[#94a3b8] hover:border-roche-light"
                    )}>
                    {f === "weekly" ? "Weekly" : "Daily"}
                  </button>
                ))}
              </div>
            </Field>

            {/* Day of week */}
            {frequency === "weekly" && (
              <Field label="Day of week">
                <div className="flex gap-1 flex-wrap">
                  {DOW.map((d, i) => (
                    <button key={i} type="button" onClick={() => set("cron_day_of_week", i)}
                      className={cn(
                        "px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-colors",
                        (form.cron_day_of_week ?? 1) === i
                          ? "bg-roche-blue text-white border-roche-blue dark:bg-[#2563eb] dark:border-[#2563eb]"
                          : "border-gray-200 dark:border-[#1e3a5f] text-gray-500 dark:text-[#94a3b8] hover:border-roche-light"
                      )}>
                      {d}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {/* Time — side by side */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hour (0–23)">
                <input type="number" min={0} max={23} value={form.cron_hour ?? 8}
                  onChange={e => set("cron_hour", Number(e.target.value))} className={input} />
              </Field>
              <Field label="Minute (0–59)">
                <input type="number" min={0} max={59} value={form.cron_minute ?? 0}
                  onChange={e => set("cron_minute", Number(e.target.value))} className={input} />
              </Field>
            </div>

            {/* Enable toggle */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium">Auto-run enabled</p>
                <p className="text-xs text-gray-400 dark:text-[#64748b]">Pipeline fires automatically on schedule</p>
              </div>
              <Toggle value={!!form.cron_enabled} onChange={v => set("cron_enabled", v)} />
            </div>
          </Card>

          {/* Budget */}
          <Card icon={<Gauge size={16} />} title="Pipeline Budget" subtitle="Limit API calls per run">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Agent calls / run">
                <input type="number" min={1} value={form.agent_budget_per_run ?? 250}
                  onChange={e => set("agent_budget_per_run", Number(e.target.value))} className={input} />
                <p className="text-xs text-gray-400 dark:text-[#64748b] mt-1">TinyFish agent credits</p>
              </Field>
              <Field label="LLM hard stop">
                <input type="number" min={1} value={form.llm_budget_hard_stop ?? 500}
                  onChange={e => set("llm_budget_hard_stop", Number(e.target.value))} className={input} />
                <p className="text-xs text-gray-400 dark:text-[#64748b] mt-1">Total LLM calls cap</p>
              </Field>
            </div>
          </Card>

        </div>
      </div>

      {/* ── Save button ── */}
      <div className="flex items-center gap-4">
        <button onClick={() => updateMut.mutate()} disabled={updateMut.isPending}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-sm transition-all",
            saveState === "saved" ? "bg-green-600 text-white shadow-lg shadow-green-600/20" :
            saveState === "error" ? "bg-red-600 text-white" :
            "bg-roche-blue text-white hover:bg-roche-light dark:bg-[#2563eb] dark:hover:bg-[#3b82f6] shadow-md shadow-roche-blue/20 disabled:opacity-50"
          )}>
          <Save size={16} />
          {saveState === "saved" ? "Saved!" : saveState === "error" ? "Save failed" : "Save Settings"}
        </button>
        {saveState === "idle" && (
          <p className="text-xs text-gray-400 dark:text-[#64748b]">Changes apply on next pipeline run.</p>
        )}
      </div>

    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────

const input = [
  "w-full px-3 py-2 text-sm rounded-lg",
  "border border-gray-200 dark:border-[#1e3a5f]",
  "bg-white dark:bg-[#0a0f1e]",
  "text-gray-900 dark:text-[#e2e8f0]",
  "focus:outline-none focus:ring-2 focus:ring-roche-light/50 dark:focus:ring-[#2563eb]/50",
  "transition-colors",
].join(" ");

// ── Sub-components ────────────────────────────────────────

function Card({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-[#111827] rounded-xl border border-gray-100 dark:border-[#1e3a5f] shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-[#1e3a5f]/60 bg-gray-50/50 dark:bg-[#0a0f1e]/40">
        <div className="flex items-center gap-2">
          <span className="text-roche-light dark:text-[#2563eb]">{icon}</span>
          <div>
            <h2 className="font-semibold text-sm text-gray-900 dark:text-[#e2e8f0]">{title}</h2>
            {subtitle && <p className="text-xs text-gray-400 dark:text-[#64748b]">{subtitle}</p>}
          </div>
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#64748b]">
        {label}
      </label>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-roche-light/50",
        value ? "bg-roche-light dark:bg-[#2563eb]" : "bg-gray-200 dark:bg-[#1e3a5f]"
      )}>
      <span className={cn(
        "block w-4 h-4 rounded-full bg-white shadow-md transition-transform absolute top-1",
        value ? "translate-x-6" : "translate-x-1"
      )} />
    </button>
  );
}

function ModelField({ label, value, onChange, suggestions }: {
  label: string; value: string; onChange: (v: string) => void; suggestions: string[];
}) {
  return (
    <Field label={label}>
      {suggestions.length > 0 ? (
        <div className="relative">
          <select value={value} onChange={e => onChange(e.target.value)} className={`${input} appearance-none pr-8 font-mono`}>
            {!suggestions.includes(value) && value && <option value={value}>{value}</option>}
            {suggestions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" />
        </div>
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)}
          placeholder="e.g. gemini-2.5-flash" className={`${input} font-mono`} />
      )}
    </Field>
  );
}
