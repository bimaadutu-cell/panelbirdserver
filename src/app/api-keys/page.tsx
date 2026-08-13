"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Key, Plus, Trash2, Copy, ShieldAlert, Check, Shield } from "lucide-react";

export default function ApiKeysPage() {
  const [user, setUser] = useState<any>(null);
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Key Modal & Secret Popup
  const [showModal, setShowModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      if (meData.success) setUser(meData.data.user);

      const keysRes = await fetch("/api/v1/api-keys");
      const keysData = await keysRes.json();
      if (keysData.success) setKeys(keysData.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedSecret(data.data.secretKey);
        setShowModal(false);
        setKeyName("");
        fetchKeys();
      } else {
        alert(data.error?.message || "Failed to create API Key");
      }
    } catch {
      alert("Failed to create API Key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this API Key permanently?")) return;
    try {
      const res = await fetch(`/api/v1/api-keys?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) fetchKeys();
    } catch {
      alert("Revoke failed");
    }
  };

  const handleCopySecret = () => {
    if (generatedSecret) {
      navigator.clipboard.writeText(generatedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-transparent text-white flex items-center justify-center">Loading API key policy...</div>;
  }

  // ⚠️ ABSOLUTE BIRDSERVER RULE: ONLY ADMIN CAN ACCESS API KEYS
  if (user && user.role !== "admin") {
    return (
      <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
        <Sidebar user={user} />
        <main className="flex-1 p-8 flex items-center justify-center">
          <div className="bg-zinc-950 border border-red-800/80 p-8 rounded-3xl max-w-lg text-center space-y-4 shadow-2xl">
            <ShieldAlert className="w-12 h-12 text-red-400 mx-auto" />
            <h2 className="text-xl font-bold text-white">403 FORBIDDEN - ACCESS DENIED</h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Hanya admin yang diperbolehkan membuat, melihat, dan mengelola API keys di Birdserver V1. User biasa dan reseller ditolak penuh oleh backend.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <Key className="w-6 h-6 text-white" /> Account API Keys
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Programmatic access keys for Birdserver REST API integrations & automated ordering
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(255,255,255,0.3)]"
          >
            <Plus className="w-4 h-4" /> Generate New API Key
          </button>
        </div>

        {/* API Secret Display Modal (Shown ONCE) */}
        {generatedSecret && (
          <div className="p-6 bg-emerald-950/60 border border-emerald-800 rounded-3xl space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                <Check className="w-5 h-5" /> API Key Created Successfully
              </h3>
              <button onClick={() => setGeneratedSecret(null)} className="text-xs text-zinc-400 hover:text-white">
                Close Notice
              </button>
            </div>
            <p className="text-xs text-zinc-300">
              Please copy and store your API secret key now. <span className="font-bold text-white underline">It will never be displayed again!</span>
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={generatedSecret}
                className="flex-1 bg-black border border-emerald-800 rounded-xl px-3 py-2 text-xs text-emerald-300 font-mono font-bold focus:outline-none"
              />
              <button
                onClick={handleCopySecret}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 flex items-center gap-1.5"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy Key"}
              </button>
            </div>
          </div>
        )}

        {/* API Documentation */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4 shadow-2xl">
          <div>
            <h3 className="text-base font-bold text-white">API Documentation: Create Account + Server with API Key</h3>
            <p className="text-xs text-zinc-400 mt-1">
              Secret API key hanya tampil satu kali saat dibuat. Hanya admin yang dapat menggunakan seluruh endpoint API key dan provisioning automation ini.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="bg-black border border-zinc-800 rounded-2xl p-4 overflow-x-auto">
              <p className="text-zinc-400 mb-2 font-bold">1) Buat API Key (Admin only)</p>
              <pre className="text-zinc-300 font-mono whitespace-pre-wrap">{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'https://your-panel-domain'}/api/v1/api-keys \\
  -H "Content-Type: application/json" \\
  --cookie "birdserver_session=YOUR_SESSION_COOKIE" \\
  -d '{"name":"automation-key"}'`}</pre>
            </div>

            <div className="bg-black border border-zinc-800 rounded-2xl p-4 overflow-x-auto">
              <p className="text-zinc-400 mb-2 font-bold">2) Admin create account + server in one request</p>
              <pre className="text-zinc-300 font-mono whitespace-pre-wrap">{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'https://your-panel-domain'}/api/v1/admin/provision \\
  -H "Authorization: Bearer bs_xxxxxxxxxxxxxxxxx" \\
  -H "Idempotency-Key: provision-123456" \\
  -H "Content-Type: application/json" \\
  -d '{
    "username":"customerbaru",
    "email":"customerbaru@example.com",
    "password":"SecurePass123!",
    "role":"user",
    "serverName":"WhatsApp Bot Production",
    "templateId":"egg_whatsapp",
    "memoryMb":2048,
    "cpuPercent":200,
    "diskMb":10240
  }'`}</pre>
            </div>

            <div className="bg-black border border-zinc-800 rounded-2xl p-4 overflow-x-auto">
              <p className="text-zinc-400 mb-2 font-bold">3) Start provisioned server via API Key</p>
              <pre className="text-zinc-300 font-mono whitespace-pre-wrap">{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'https://your-panel-domain'}/api/v1/servers/SERVER_ID/power \\
  -H "Authorization: Bearer bs_xxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"start"}'`}</pre>
            </div>
          </div>
        </div>

        {/* Keys List */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Key Name</th>
                <th className="p-3.5">Prefix Identifier</th>
                <th className="p-3.5">Last Used</th>
                <th className="p-3.5">Created At</th>
                <th className="p-3.5 text-right">Revoke</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">Loading API keys...</td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500 italic">
                    No active API keys found. Click "Generate New API Key" above to create one.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} className="hover:bg-zinc-900/50">
                    <td className="p-3.5 font-bold text-white flex items-center gap-2">
                      <Key className="w-4 h-4 text-white" />
                      {k.name}
                    </td>
                    <td className="p-3.5 font-mono text-zinc-400">{k.keyPrefix}...</td>
                    <td className="p-3.5 font-mono text-zinc-400 font-bold">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-zinc-500">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => handleRevoke(k.id)}
                        className="p-1.5 text-red-400 hover:bg-red-950/50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Generate Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
              <h3 className="text-base font-bold text-white">Generate API Key</h3>
              <form onSubmit={handleCreateKey} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Key Name / Description</label>
                  <input
                    type="text"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Auto-Order Telegram Bot Token"
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-white"
                  />
                </div>
                <div className="flex justify-end space-x-2">
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
                    {creating ? "Generating Key..." : "Generate Key"}
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
