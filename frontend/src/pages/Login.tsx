import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Lock, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.auth.login(email.trim(), password);
      setAuth(r.access_token, r.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0a0f1e] px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-roche-blue text-white flex items-center justify-center text-lg font-bold shadow-lg">
            RR
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">RocheRadar</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={submit}
          className="glass-panel rounded-2xl p-6 space-y-4 shadow-xl border border-slate-200/60 dark:border-white/10">
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email</label>
            <input type="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0f2744] text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-roche-blue/40"
              placeholder="you@roche.com" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Password</label>
            <input type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0f2744] text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-roche-blue/40"
              placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-roche-blue hover:bg-roche-light text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-center text-[11px] text-slate-400 mt-4">
          Accounts are provisioned by an administrator.
        </p>
      </div>
    </div>
  );
}
