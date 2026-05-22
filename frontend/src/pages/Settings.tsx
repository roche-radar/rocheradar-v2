import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Save, RefreshCw, CheckCircle, XCircle, ChevronDown } from "lucide-react";
import { api, type AppSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

const PROVIDER_NOTES: Record<string, string> = {
  vertex:     "Uses GCP service account / ADC. No API key needed here.",
  openrouter: "Access 200+ models. Get key at openrouter.ai",
  ollama:     "Local inference. Make sure Ollama is running.",
  nvidia:     "NVIDIA NIM cloud models. Get key at build.nvidia.com",
  anthropic:  "Claude models. Get key at console.anthropic.com",
  openai:     "GPT models. Get key at platform.openai.com",
  gemini:     "Gemini via AI Studio. Get key at aistudio.google.com",
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const [form, setForm] = useState<Partial<AppSettings & { api_key: string }>>({});
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [testState, setTestState] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => { if (settings) setForm({ ...settings, api_key: "" }); }, [settings]);

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
    setModelsLoading(true);
    setModels([]);
    try {
      const res = await api.settings.fetchModels({ provider: form.llm_provider, api_key: form.api_key || undefined });
      setModels(res.models);
    } catch { setModels([]); }
    setModelsLoading(false);
  }

  async function testConnection() {
    setTestState("loading");
    setTestError("");
    try {
      await api.settings.testConnection({ provider: form.llm_provider, api_key: form.api_key || undefined, model: form.llm_pro_model });
      setTestState("ok");
    } catch (e: unknown) {
      setTestState("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    }
    setTimeout(() => setTestState("idle"), 6000);
  }

  if (isLoading) return <div className="text-center py-12 text-gray-400">Loading…</div>;

  const provider = form.llm_provider || "vertex";
  const needsKey = provider !== "vertex" && provider !== "ollama";
  const needsOllamaUrl = provider === "ollama";
  const needsNvidiaUrl = provider === "nvidia";

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-roche-blue dark:text-white">Settings</h1>

      {/* ── LLM Provider ── */}
      <Section title="LLM Provider">
        {/* Provider picker */}
        <Field label="Provider">
          <div className="relative">
            <select
              value={provider}
              onChange={e => { set("llm_provider", e.target.value); setModels([]); setTestState("idle"); }}
              className="w-full px-3 py-2 pr-8 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 appearance-none cursor-pointer"
            >
              {Object.entries(settings?.available_providers ?? {}).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" />
          </div>
          {PROVIDER_NOTES[provider] && (
            <p className="text-xs text-gray-400 mt-1">{PROVIDER_NOTES[provider]}</p>
          )}
        </Field>

        {/* API key */}
        {needsKey && (
          <Field label={`API Key${settings?.api_key_set ? " (set — enter new to replace)" : ""}`}>
            <input
              type="password"
              placeholder={settings?.api_key_set ? "••••••••  (leave blank to keep)" : "Paste your API key"}
              value={form.api_key ?? ""}
              onChange={e => set("api_key", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono"
            />
          </Field>
        )}

        {/* Ollama base URL */}
        {needsOllamaUrl && (
          <Field label="Ollama Base URL">
            <input
              value={form.ollama_base_url ?? "http://localhost:11434"}
              onChange={e => set("ollama_base_url", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono"
            />
          </Field>
        )}

        {/* NVIDIA base URL */}
        {needsNvidiaUrl && (
          <Field label="NVIDIA NIM Base URL">
            <input
              value={form.nvidia_base_url ?? "https://integrate.api.nvidia.com/v1"}
              onChange={e => set("nvidia_base_url", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono"
            />
          </Field>
        )}

        {/* OpenAI custom base URL */}
        {provider === "openai" && (
          <Field label="Custom Base URL (optional — for Azure / local OpenAI-compat)">
            <input
              value={form.custom_base_url ?? ""}
              onChange={e => set("custom_base_url", e.target.value)}
              placeholder="https://your-endpoint/v1"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono"
            />
          </Field>
        )}

        {/* Model pickers */}
        <div className="flex gap-2 items-end pt-1">
          <button
            onClick={fetchModels}
            disabled={modelsLoading}
            className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 hover:text-roche-light flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={12} className={modelsLoading ? "animate-spin" : ""} />
            {modelsLoading ? "Fetching…" : "Fetch models"}
          </button>
          {models.length > 0 && (
            <span className="text-xs text-gray-400">{models.length} models available</span>
          )}
        </div>

        <ModelField
          label="Pro model (extraction + summaries)"
          value={form.llm_pro_model ?? ""}
          onChange={v => set("llm_pro_model", v)}
          suggestions={models}
        />
        <ModelField
          label="Flash model (fast filtering)"
          value={form.llm_flash_model ?? ""}
          onChange={v => set("llm_flash_model", v)}
          suggestions={models}
        />

        {/* Test connection */}
        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={testConnection}
            disabled={testState === "loading"}
            className="text-sm px-4 py-2 border border-roche-light text-roche-light rounded-lg hover:bg-roche-light hover:text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {testState === "loading"
              ? <><RefreshCw size={13} className="animate-spin" /> Testing…</>
              : testState === "ok"
              ? <><CheckCircle size={13} className="text-green-500" /> Connected</>
              : testState === "fail"
              ? <><XCircle size={13} className="text-red-500" /> Failed</>
              : "Test connection"}
          </button>
          {testError && <span className="text-xs text-red-500 max-w-xs truncate">{testError}</span>}
        </div>
      </Section>

      {/* ── Daily Schedule ── */}
      <Section title="Daily Schedule">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Hour (0–23)">
            <input type="number" min={0} max={23}
              value={form.cron_hour ?? 8}
              onChange={e => set("cron_hour", Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800"
            />
          </Field>
          <Field label="Minute (0–59)">
            <input type="number" min={0} max={59}
              value={form.cron_minute ?? 0}
              onChange={e => set("cron_minute", Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800"
            />
          </Field>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-medium">Enable daily auto-run</span>
          <Toggle value={!!form.cron_enabled} onChange={v => set("cron_enabled", v)} />
        </div>
      </Section>

      {/* ── Budget ── */}
      <Section title="Pipeline Budget">
        <Field label="Agent calls per run">
          <input type="number" min={1}
            value={form.agent_budget_per_run ?? 250}
            onChange={e => set("agent_budget_per_run", Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800"
          />
        </Field>
        <Field label="LLM hard stop (total calls)">
          <input type="number" min={1}
            value={form.llm_budget_hard_stop ?? 500}
            onChange={e => set("llm_budget_hard_stop", Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800"
          />
        </Field>
      </Section>

      <button
        onClick={() => updateMut.mutate()}
        disabled={updateMut.isPending}
        className={cn(
          "flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors",
          saveState === "saved" ? "bg-green-600 text-white" :
          saveState === "error" ? "bg-red-600 text-white" :
          "bg-roche-blue text-white hover:bg-roche-light disabled:opacity-50"
        )}
      >
        <Save size={16} />
        {saveState === "saved" ? "Saved!" : saveState === "error" ? "Save failed" : "Save Settings"}
      </button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
      <h2 className="font-semibold text-sm uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        "relative w-10 h-5 rounded-full transition-colors focus:outline-none",
        value ? "bg-roche-light" : "bg-gray-200 dark:bg-gray-600"
      )}
    >
      <span className={cn(
        "block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-0.5",
        value ? "translate-x-5" : "translate-x-0.5"
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
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full px-3 py-2 pr-8 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 appearance-none font-mono"
          >
            {!suggestions.includes(value) && value && (
              <option value={value}>{value}</option>
            )}
            {suggestions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" />
        </div>
      ) : (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. gemini-2.5-pro"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono"
        />
      )}
    </Field>
  );
}
