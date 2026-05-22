import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { api, type AppSettings } from "@/lib/api";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const [form, setForm] = useState<Partial<AppSettings>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: () => api.settings.update(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });

  const field = (key: keyof AppSettings, label: string, type: "text" | "number" | "toggle" = "text") => (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 dark:border-gray-700/50">
      <label className="text-sm font-medium">{label}</label>
      {type === "toggle" ? (
        <button
          onClick={() => setForm((f) => ({ ...f, [key]: !f[key] }))}
          className={`w-10 h-5 rounded-full transition-colors ${form[key] ? "bg-roche-light" : "bg-gray-200"}`}
        >
          <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${form[key] ? "translate-x-5" : ""}`} />
        </button>
      ) : (
        <input
          type={type}
          value={(form[key] as string | number) ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value }))}
          className="w-48 px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-transparent text-right"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-roche-blue dark:text-white">Settings</h1>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold mb-3">LLM Routing</h2>
        {field("llm_pro_model", "Pro Model (extraction + summaries)")}
        {field("llm_flash_model", "Flash Model (fast filtering)")}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold mb-3">Daily Schedule</h2>
        {field("cron_hour", "Hour (0–23)", "number")}
        {field("cron_minute", "Minute (0–59)", "number")}
        {field("cron_enabled", "Enable daily auto-run", "toggle")}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold mb-3">Budget Limits</h2>
        {field("agent_budget_per_run", "Agent calls per run", "number")}
        {field("llm_budget_hard_stop", "LLM hard stop (calls)", "number")}
      </div>

      <button
        onClick={() => updateMut.mutate()}
        disabled={updateMut.isPending}
        className="flex items-center gap-2 px-5 py-2.5 bg-roche-blue text-white rounded-lg font-medium hover:bg-roche-light disabled:opacity-50"
      >
        <Save size={16} />
        {saved ? "Saved!" : "Save Settings"}
      </button>
    </div>
  );
}
