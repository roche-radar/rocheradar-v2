import { useQuery } from "@tanstack/react-query";
import { Download, Eye, FileText, X, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useState } from "react";

export default function Reports() {
  const { data: pdfs, isLoading, isError, error } = useQuery({ queryKey: ["pdfs"], queryFn: api.reports.list });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");

  function openPreview(path: string, name: string) {
    const encoded = encodeURI(path);
    setPreviewUrl(`/api/reports/download/${encoded}?inline=true`);
    setPreviewName(name);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-roche-blue dark:text-[#e2e8f0]">Reports</h1>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : isError ? (
        <div className="text-center py-12 text-gray-400">
          <div>Failed to load PDFs.</div>
          <div className="mt-2 text-xs font-mono text-gray-500">
            {error instanceof Error ? error.message : "Unknown error"}
          </div>
        </div>
      ) : !pdfs?.length ? (
        <div className="text-center py-12 text-gray-400">No PDFs generated yet.</div>
      ) : (
        <div className="bg-white dark:bg-[#111827] rounded-xl shadow-sm border border-gray-100 dark:border-[#1e3a5f] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-[#1e3a5f] text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-[#1e3a5f]/50">
              {pdfs.map((pdf) => (
                <tr key={pdf.path} className="hover:bg-gray-50 dark:hover:bg-[#1e2d4a]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={15} className="text-roche-light shrink-0" />
                      <span className="font-mono text-xs text-gray-600 dark:text-[#64748b]">{pdf.path}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {(pdf.size / 1024).toFixed(0)} KB
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* Preview in modal */}
                      <button
                        onClick={() => openPreview(pdf.path, pdf.name)}
                        className="text-roche-light hover:text-roche-blue"
                        title="Preview PDF"
                      >
                        <Eye size={15} />
                      </button>
                      {/* Open in new tab (inline) */}
                      <a
                        href={`/api/reports/download/${encodeURI(pdf.path)}?inline=true`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-roche-light hover:text-roche-blue"
                        title="Open in new tab"
                      >
                        <ExternalLink size={15} />
                      </a>
                      {/* Download */}
                      <a
                        href={`/api/reports/download/${encodeURI(pdf.path)}`}
                        download={pdf.name}
                        className="text-roche-light hover:text-roche-blue"
                        title="Download"
                      >
                        <Download size={15} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PDF Modal — uses iframe which works reliably in all modern browsers */}
      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewUrl(null); }}
        >
          <div className="bg-white dark:bg-[#0a0f1e] rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-[#1e3a5f] shrink-0">
              <span className="font-medium text-sm text-gray-800 dark:text-[#e2e8f0] truncate">{previewName}</span>
              <div className="flex items-center gap-3 ml-4 shrink-0">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-roche-light hover:text-roche-blue flex items-center gap-1"
                  title="Open in new tab"
                >
                  <ExternalLink size={13} /> New tab
                </a>
                <button
                  onClick={() => setPreviewUrl(null)}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* iframe — most reliable cross-browser PDF renderer */}
            <iframe
              src={previewUrl}
              className="flex-1 w-full border-0 rounded-b-xl"
              title={previewName}
            />
          </div>
        </div>
      )}
    </div>
  );
}
