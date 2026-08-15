"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Globe, Plus } from "lucide-react";

export default function AdminAllocationsPage() {
  const [user, setUser] = useState<any>(null);
  const [allocs, setAllocs] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const aRes = await fetch("/api/v1/admin/allocations");
        const aData = await aRes.json();
        if (aData.success) setAllocs(aData.data || []);
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
            <Globe className="w-6 h-6 text-white" /> Network IP & Port Allocations
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Cluster networking ports assigned to container instances
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">IP Address</th>
                <th className="p-3.5">Port</th>
                <th className="p-3.5">Alias</th>
                <th className="p-3.5">Assigned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {allocs.map((a) => (
                <tr key={a.id} className="hover:bg-zinc-900/50">
                  <td className="p-3.5 font-mono text-white font-bold">{a.ip}</td>
                  <td className="p-3.5 font-mono text-emerald-400 font-bold">{a.port}</td>
                  <td className="p-3.5 font-mono text-zinc-400">{a.alias || "-"}</td>
                  <td className="p-3.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      a.isAssigned ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-400"
                    }`}>
                      {a.isAssigned ? "Assigned" : "Available"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
