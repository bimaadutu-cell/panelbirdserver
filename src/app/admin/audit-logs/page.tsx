"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { FileText } from "lucide-react";

export default function AdminAuditLogsPage() {
  const [user, setUser] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const lRes = await fetch("/api/v1/admin/audit-logs");
        const lData = await lRes.json();
        if (lData.success) setLogs(lData.data || []);
      } catch (err) {
        console.error(err);
      }
    }
    loadData();
  }, []);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-white" /> Global Audit Logs
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            System-wide activity audit trail with sanitized details
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">User ID</th>
                <th className="p-3.5">Action</th>
                <th className="p-3.5">IP Address</th>
                <th className="p-3.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-zinc-900/50">
                  <td className="p-3.5 font-mono text-zinc-400">{l.userId || "System"}</td>
                  <td className="p-3.5 font-bold font-mono text-white">{l.action}</td>
                  <td className="p-3.5 font-mono text-zinc-400">{l.ipAddress}</td>
                  <td className="p-3.5 font-mono text-[11px] text-zinc-500">{new Date(l.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
