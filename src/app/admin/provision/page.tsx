"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Rocket, UserPlus, Server, Shield } from "lucide-react";

export default function AdminProvisionPage() {
  const [user, setUser] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "user",
    serverName: "",
    templateId: "",
    nodeId: "",
    memoryMb: 1024,
    cpuPercent: 100,
    diskMb: 5120,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      const me = await fetch("/api/auth/me").then((r) => r.json());
      if (me.success) setUser(me.data.user);
      const tmpl = await fetch("/api/v1/admin/templates").then((r) => r.json());
      if (tmpl.success) setTemplates(tmpl.data || []);
      const nd = await fetch("/api/v1/admin/nodes").then((r) => r.json());
      if (nd.success) setNodes(nd.data || []);
    }
    loadData();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/v1/admin/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, createServer: true }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        setForm({ username: "", email: "", password: "", role: "user", serverName: "", templateId: "", nodeId: "", memoryMb: 1024, cpuPercent: 100, diskMb: 5120 });
      } else {
        setErrorMessage(data.error?.message || "Provision failed");
      }
    } catch {
      setErrorMessage("Provision failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />
      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Rocket className="w-6 h-6 text-white" /> Quick Account + Server Provision
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Admin dapat membuat akun dan server sekaligus dengan cepat dari satu form.</p>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-zinc-950/85 border border-zinc-800 rounded-3xl p-6 space-y-4 backdrop-blur">
            <h3 className="text-base font-bold text-white flex items-center gap-2"><UserPlus className="w-5 h-5" /> Account</h3>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Username" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs" required />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs" required />
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" type="password" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs" required />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs">
              <option value="user">User</option>
              <option value="reseller">Reseller</option>
            </select>
          </div>

          <div className="bg-zinc-950/85 border border-zinc-800 rounded-3xl p-6 space-y-4 backdrop-blur">
            <h3 className="text-base font-bold text-white flex items-center gap-2"><Server className="w-5 h-5" /> Server</h3>
            <input value={form.serverName} onChange={(e) => setForm({ ...form, serverName: e.target.value })} placeholder="Server name" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs" required />
            <select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs">
              <option value="">Default Node.js</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={form.nodeId} onChange={(e) => setForm({ ...form, nodeId: e.target.value })} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs">
              <option value="">Auto select node</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-3">
              <input value={form.memoryMb} onChange={(e) => setForm({ ...form, memoryMb: Number(e.target.value) })} type="number" placeholder="RAM MB" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs" />
              <input value={form.cpuPercent} onChange={(e) => setForm({ ...form, cpuPercent: Number(e.target.value) })} type="number" placeholder="CPU %" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs" />
              <input value={form.diskMb} onChange={(e) => setForm({ ...form, diskMb: Number(e.target.value) })} type="number" placeholder="Disk MB" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs" />
            </div>
          </div>

          <div className="lg:col-span-2">
            <button type="submit" disabled={loading} className="px-5 py-3 rounded-2xl bg-white text-black font-bold text-sm hover:bg-zinc-200 disabled:opacity-50">
              {loading ? "Provisioning..." : "Create Account + Server"}
            </button>
          </div>
        </form>

        {errorMessage && (
          <div className="bg-zinc-950/90 border border-red-500/30 rounded-3xl p-6 backdrop-blur space-y-4">
            <div>
              <h3 className="text-base font-bold text-red-400">Create manual gagal</h3>
              <p className="mt-2 text-sm text-zinc-300">Jika create manual eror sihlakan create di bot ini @aksesbotmuv1_bot</p>
            </div>
            <a
              href="https://t.me/aksesbotmuv1_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200"
            >
              Create Instan di Telegram
            </a>
          </div>
        )}

        {result && (
          <div className="bg-zinc-950/85 border border-emerald-500/20 rounded-3xl p-6 backdrop-blur">
            <h3 className="text-base font-bold text-emerald-400">Provision Success</h3>
            <div className="mt-3 text-xs font-mono text-zinc-300 space-y-1">
              <div>User: {result.user.username} ({result.user.email})</div>
              <div>Server: {result.server?.name}</div>
              <div>Server ID: {result.server?.id}</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
