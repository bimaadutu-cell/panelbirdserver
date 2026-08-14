"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Users, Plus, ShieldCheck, Trash2 } from "lucide-react";

export default function AdminUsersPage() {
  const [user, setUser] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [creating, setCreating] = useState(false);
  const [createServer, setCreateServer] = useState(true);
  const [serverName, setServerName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [memoryMb, setMemoryMb] = useState(1024);
  const [cpuPercent, setCpuPercent] = useState(100);
  const [diskMb, setDiskMb] = useState(5120);
  const [templates, setTemplates] = useState<any[]>([]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      if (meData.success) setUser(meData.data.user);

      const uRes = await fetch("/api/v1/admin/users");
      const uData = await uRes.json();
      if (uData.success) setUsersList(uData.data || []);
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
    fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const res = await fetch("/api/v1/admin/provision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `manual-${Date.now()}-${username}`,
        },
        body: JSON.stringify({
          username,
          email,
          password,
          role,
          createServer,
          serverName: serverName.trim() || undefined,
          templateId: templateId || undefined,
          memoryMb: Number(memoryMb),
          cpuPercent: Number(cpuPercent),
          diskMb: Number(diskMb),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setUsername("");
        setEmail("");
        setPassword("");
        setCreateServer(true);
        setServerName("");
        setTemplateId("");
        setMemoryMb(1024);
        setCpuPercent(100);
        setDiskMb(5120);
        fetchUsers();
      } else {
        alert(data.error?.message || "User creation failed");
      }
    } catch {
      alert("User creation failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-white" /> Admin User Management
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Global user directory, roles & privilege assignments
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(255,255,255,0.3)]"
          >
            <Plus className="w-4 h-4" /> Create User
          </button>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Username</th>
                <th className="p-3.5">Email</th>
                <th className="p-3.5">Role</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">Loading users...</td>
                </tr>
              ) : (
                usersList.map((u) => (
                  <tr key={u.id} className="hover:bg-zinc-900/50">
                    <td className="p-3.5 font-bold text-white">{u.username}</td>
                    <td className="p-3.5 font-mono text-zinc-400">{u.email}</td>
                    <td className="p-3.5 font-mono font-bold uppercase text-white">{u.role}</td>
                    <td className="p-3.5">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {u.status}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-zinc-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4">
              <h3 className="text-base font-bold text-white">Create Account + Server</h3>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="user">USER BIASA</option>
                    <option value="reseller">RESELLER</option>
                    <option value="admin">ADMIN</option>
                  </select>
                </div>
                <div className="border-t border-zinc-800 pt-4 space-y-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createServer}
                      onChange={(e) => setCreateServer(e.target.checked)}
                      className="accent-white"
                    />
                    Buat server otomatis untuk akun ini
                  </label>

                  {createServer && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">Nama Server</label>
                        <input
                          type="text"
                          value={serverName}
                          onChange={(e) => setServerName(e.target.value)}
                          placeholder={`${username || "user"}-server`}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">Template</label>
                        <select
                          value={templateId}
                          onChange={(e) => setTemplateId(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        >
                          <option value="">Default Node.js</option>
                          {templates.map((tmpl) => (
                            <option key={tmpl.id} value={tmpl.id}>{tmpl.name} — {tmpl.category}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">RAM (MB)</label>
                        <input type="number" min={128} value={memoryMb} onChange={(e) => setMemoryMb(Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">CPU (%)</label>
                        <input type="number" min={1} value={cpuPercent} onChange={(e) => setCpuPercent(Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">Disk (MB)</label>
                        <input type="number" min={256} value={diskMb} onChange={(e) => setDiskMb(Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200"
                  >
                    {creating ? "Creating..." : "Create User"}
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
