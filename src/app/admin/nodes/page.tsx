"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { HardDrive, Plus, Circle } from "lucide-react";

export default function AdminNodesPage() {
  const [user, setUser] = useState<any>(null);
  const [nodes, setNodes] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const nRes = await fetch("/api/v1/admin/nodes");
        const nData = await nRes.json();
        if (nData.success) setNodes(nData.data || []);
      } catch (err) {
        console.error(err);
      }
    }
    loadData();
  }, []);

  const totalDiskGb = Math.round(nodes.reduce((sum, node) => sum + (node.diskMb || 0), 0) / 1024);
  const totalRamGb = Math.round(nodes.reduce((sum, node) => sum + (node.memoryMb || 0), 0) / 1024);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-white" /> Node Infrastructure Cluster
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Real Linux Docker execution nodes connected via Birdserver Agent
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-zinc-950/85 border border-zinc-800 p-5 rounded-3xl backdrop-blur">
            <div className="text-xs text-zinc-400">Total Nodes</div>
            <div className="mt-2 text-2xl font-black text-white">{nodes.length}</div>
          </div>
          <div className="bg-zinc-950/85 border border-zinc-800 p-5 rounded-3xl backdrop-blur">
            <div className="text-xs text-zinc-400">Cluster RAM</div>
            <div className="mt-2 text-2xl font-black text-white">{totalRamGb} GB</div>
          </div>
          <div className="bg-zinc-950/85 border border-zinc-800 p-5 rounded-3xl backdrop-blur">
            <div className="text-xs text-zinc-400">Cluster Disk</div>
            <div className="mt-2 text-2xl font-black text-white">{totalDiskGb} GB</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {nodes.map((n) => (
            <div key={n.id} className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-white" /> {n.name}
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <Circle className="w-2 h-2 fill-emerald-400" /> ONLINE
                </span>
              </div>
              <div className="text-xs font-mono text-zinc-400 space-y-1">
                <div>FQDN IP: <span className="text-white font-bold">{n.fqdnIp}:{n.port}</span></div>
                <div>Memory Spec: <span className="text-white">{n.memoryMb} MB</span></div>
                <div>Disk Spec: <span className="text-white">{n.diskMb} MB</span></div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
