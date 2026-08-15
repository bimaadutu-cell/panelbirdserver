"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import Link from "next/link";
import { Server, Plus, Search, Play, Square, ExternalLink, HardDrive, Cpu, X, Trash2 } from "lucide-react";

export default function ServersPage() {
  const [user, setUser] = useState<any>(null);
  const [servers, setServers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Deploy Modal
  const [showDeploy, setShowDeploy] = useState(false);
  const [serverName, setServerName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [memoryMb, setMemoryMb] = useState(1024);
  const [cpuPercent, setCpuPercent] = useState(100);
  const [diskMb, setDiskMb] = useState(5120);
  const [deploying, setDeploying] = useState(false);

  const fetchServers = async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      if (meData.success) setUser(meData.data.user);

      const srvRes = await fetch("/api/v1/servers");
      const srvData = await srvRes.json();
      if (srvData.success) setServers(srvData.data || []);

      const tmplRes = await fetch("/api/v1/admin/templates");
      const tmplData = await tmplRes.json();
      if (tmplData.success) setTemplates(tmplData.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeploying(true);

    try {
      const res = await fetch("/api/v1/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: serverName,
          templateId: templateId || undefined,
          memoryMb: Number(memoryMb),
          cpuPercent: Number(cpuPercent),
          diskMb: Number(diskMb),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowDeploy(false);
        setServerName("");
        fetchServers();
      } else {
        alert(data.error?.message || "Server creation failed");
      }
    } catch {
      alert("Server creation failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleDeleteServer = async (serverId: string, serverName: string) => {
    if (!confirm(`Hapus server ${serverName}?`)) return;
    try {
      const res = await fetch(`/api/v1/servers/${serverId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchServers();
      } else {
        alert(data.error?.message || "Server delete failed");
      }
    } catch {
      alert("Server delete failed");
    }
  };

  const filteredServers = servers.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.identifier.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <Server className="w-6 h-6 text-white" /> Server Infrastructure
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Active containers & server instances running on Birdserver node cluster
            </p>
          </div>

          {user?.role === "admin" ? (
            <button
              onClick={() => setShowDeploy(true)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(255,255,255,0.3)]"
            >
              <Plus className="w-4 h-4" /> Deploy New Server
            </button>
          ) : null}
        </div>

        {/* Search */}
        <div className="relative w-full max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by server name or 8-char identifier..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600"
          />
        </div>

        {/* Server Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServers.map((server) => (
            <div
              key={server.id}
              className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 space-y-4 hover:border-zinc-600 transition-all shadow-xl relative flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
                    {server.identifier}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                      server.status === "running"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                    }`}
                  >
                    {server.status}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white mt-3">{server.name}</h3>
                <p className="text-xs text-zinc-500 font-mono mt-1">{server.dockerImage}</p>
              </div>

              <div className="pt-4 border-t border-zinc-900 space-y-3">
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-zinc-400">
                  <div>
                    <span className="block text-[10px] text-zinc-600 uppercase">RAM</span>
                    <span className="font-bold text-zinc-200">{server.memoryMb} MB</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-600 uppercase">CPU</span>
                    <span className="font-bold text-zinc-200">{server.cpuPercent}%</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-600 uppercase">Disk</span>
                    <span className="font-bold text-zinc-200">{server.diskMb} MB</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`/servers/${server.id}`}
                    className="flex-1 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                  >
                    <span>Open Console & Files</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                  {user?.role === "admin" ? (
                    <button
                      onClick={() => handleDeleteServer(server.id, server.name)}
                      className="px-3 py-2 rounded-xl bg-red-950/80 text-red-400 border border-red-800/80 hover:bg-red-900 transition-all"
                      title="Delete Server"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Deploy Modal */}
        {showDeploy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">Deploy New Server Container</h3>
                <button onClick={() => setShowDeploy(false)} className="p-1 text-zinc-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleDeploy} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Server Name</label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="My WhatsApp Bot Server"
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Egg / Template</label>
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="">-- Custom / Default Node.js --</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">RAM (MB)</label>
                    <input
                      type="number"
                      value={memoryMb}
                      onChange={(e) => setMemoryMb(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">CPU (%)</label>
                    <input
                      type="number"
                      value={cpuPercent}
                      onChange={(e) => setCpuPercent(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">Disk (MB)</label>
                    <input
                      type="number"
                      value={diskMb}
                      onChange={(e) => setDiskMb(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowDeploy(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deploying}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {deploying ? "Deploying Container..." : "Provision Container"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
