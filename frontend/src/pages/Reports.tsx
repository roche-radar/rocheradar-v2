import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { api } from "@/lib/api";

export default function Reports() {
  const { data: pdfs, isLoading } = useQuery({ queryKey: ["pdfs"], queryFn: api.reports.list });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-roche-blue dark:text-white">Reports</h1>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : !pdfs?.length ? (
        <div className="text-center py-12 text-gray-400">No PDFs generated yet.</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {pdfs.map((pdf) => (
                <tr key={pdf.path} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={15} className="text-roche-light shrink-0" />
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{pdf.path}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {(pdf.size / 1024).toFixed(0)} KB
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/api/reports/download/${pdf.path}`}
                      download={pdf.name}
                      className="text-roche-light hover:text-roche-blue"
                      title="Download"
                    >
                      <Download size={15} />
                    </a>
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
