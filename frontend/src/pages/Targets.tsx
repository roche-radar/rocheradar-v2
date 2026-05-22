import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";
import { api, type Target } from "@/lib/api";

export default function Targets() {
  const qc = useQueryClient();
  const { data: targets, isLoading } = useQuery({ queryKey: ["targets"], queryFn: api.targets.list });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", known_urls: "", notes: "" });

  const createMut = useMutation({
    mutationFn: () => api.targets.create({
      name: form.name,
      known_urls: form.known_urls.split("\n").map((u) => u.trim()).filter(Boolean),
      notes: form.notes || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["targets"] }); setShowAdd(false); setForm({ name: "", known_urls: "", notes: "" }); },
  });

  const deactivateMut = useMutation({
    mutationFn: (id: number) => api.targets.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["targets"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-roche-blue dark:text-white">Targets</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-roche-blue text-white rounded-lg text-sm font-medium hover:bg-roche-light"
        >
          <Plus size={16} /> Add Target
        </button>
      </div>

      {showAdd && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold mb-4">New Target</h2>
          <div className="grid gap-3">
            <input
              placeholder="Full name (e.g. Jean Dupont)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-transparent"
            />
            <textarea
              placeholder="Known URLs / handles (one per line)"
              value={form.known_urls}
              onChange={(e) => setForm((f) => ({ ...f, known_urls: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-transparent resize-none"
            />
            <input
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-transparent"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!form.name || createMut.isPending}
                className="px-4 py-1.5 bg-roche-blue text-white rounded-lg text-sm disabled:opacity-50"
              >Save</button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Known URLs</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {targets?.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                    {t.known_urls.length ? `${t.known_urls.length} URL(s)` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${t.active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                      {t.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deactivateMut.mutate(t.id)}
                      disabled={!t.active}
                      className="text-red-400 hover:text-red-600 disabled:opacity-30"
                      title="Deactivate"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
