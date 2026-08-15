"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Activity, Clock } from "lucide-react";

export default function ActivityPage() {
  const [user, setUser] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLogs() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const logsRes = await fetch("/api/v1/admin/audit-logs");
        const logsData = await logsRes.json();
        if (logsData.success) setLogs(logsData.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, []);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-white" /> Account Activity Log
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time security and server action history
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Action Event</th>
                <th className="p-3.5">IP Address</th>
                <th className="p-3.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-zinc-500">Loading activity...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-zinc-500 italic">No activity logged yet.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-900/50">
                    <td className="p-3.5 font-bold text-white font-mono">{log.action}</td>
                    <td className="p-3.5 font-mono text-zinc-400">{log.ipAddress}</td>
                    <td className="p-3.5 font-mono text-[11px] text-zinc-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
