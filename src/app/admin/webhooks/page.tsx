"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Radio } from "lucide-react";

export default function AdminWebhooksPage() {
  const [user, setUser] = useState<any>(null);
  const [webhooks, setWebhooks] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const wRes = await fetch("/api/v1/admin/webhooks");
        const wData = await wRes.json();
        if (wData.success) setWebhooks(wData.data || []);
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
            <Radio className="w-6 h-6 text-white" /> Global Event Webhooks
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time HTTP event dispatchers signed with HMAC SHA256 secrets
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Name</th>
                <th className="p-3.5">Endpoint URL</th>
                <th className="p-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {webhooks.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-zinc-500 italic">No webhooks registered yet.</td>
                </tr>
              ) : (
                webhooks.map((w) => (
                  <tr key={w.id} className="hover:bg-zinc-900/50">
                    <td className="p-3.5 font-bold text-white">{w.name}</td>
                    <td className="p-3.5 font-mono text-zinc-400">{w.url}</td>
                    <td className="p-3.5 font-mono text-emerald-400 font-bold uppercase">{w.isActive ? "Active" : "Disabled"}</td>
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
