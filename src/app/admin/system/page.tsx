"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { formatBytes } from "@/lib/utils";
import { Settings, ShieldCheck, Activity, Palette, HardDrive, Trash2, RefreshCw } from "lucide-react";

export default function AdminSystemPage() {
  const [user, setUser] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [theme, setTheme] = useState<any>({ preset: "spidey-neon", overlayOpacity: 0.58, backgroundType: "none", backgroundUrl: "" });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cache, setCache] = useState<any>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const hRes = await fetch("/api/health");
        const hData = await hRes.json();
        setHealth(hData);

        const tRes = await fetch("/api/v1/admin/theme");
        const tData = await tRes.json();
        if (tData.success) setTheme(tData.data);

        const cRes = await fetch("/api/v1/admin/cache", { cache: "no-store" });
        const cData = await cRes.json();
        if (cData.success) setCache(cData.data);
      } catch (err) {
        console.error(err);
      }
    }
    loadData();
  }, []);

  const saveTheme = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(theme),
      });
      const data = await res.json();
      if (data.success) setTheme(data.data);
      else alert(data.error?.message || "Failed to save theme");
    } catch {
      alert("Failed to save theme");
    } finally {
      setSaving(false);
    }
  };

  const cleanCache = async (action: "clean_temp" | "clean_orphan" | "clean_all") => {
    setCleaning(true);
    try {
      const res = await fetch("/api/v1/admin/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) setCache(data.data.summary);
      else alert(data.error?.message || "Cache cleanup failed");
    } catch {
      alert("Cache cleanup failed");
    } finally {
      setCleaning(false);
    }
  };

  const uploadBackground = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/v1/admin/theme/background", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) setTheme(data.data);
      else alert(data.error?.message || "Failed to upload background");
    } catch {
      alert("Failed to upload background");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />
      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-white" /> Global System Settings & Diagnostics
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Spidey theme, background, diagnostics, and Birdserver infrastructure settings.</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="bg-zinc-950/85 border border-zinc-800 p-6 rounded-3xl space-y-3 shadow-xl backdrop-blur">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" /> Platform Info
            </h3>
            <div className="space-y-2 text-xs font-mono text-zinc-300">
              <div>System Name: <span className="text-white font-bold">Birdserver V1</span></div>
              <div>Developer: <span className="text-white font-bold">BimzOfficial</span></div>
              <div>Database Driver: <span className="text-emerald-400 font-bold">PostgreSQL (Drizzle ORM)</span></div>
              <div>Container Runtime: <span className="text-emerald-400 font-bold">Node.js + Linux Process Agent</span></div>
            </div>
          </div>

          <div className="bg-zinc-950/85 border border-zinc-800 p-6 rounded-3xl space-y-3 shadow-xl backdrop-blur">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" /> Health Diagnostics
            </h3>
            <div className="space-y-2 text-xs font-mono text-zinc-300">
              <div>Database Connection: <span className="text-emerald-400 font-bold">{health?.database || "connected"}</span></div>
              <div>Node Agent Service: <span className="text-emerald-400 font-bold">{health?.agent || "active"}</span></div>
              <div>Active Running Processes: <span className="text-white font-bold">{health?.activeContainersCount ?? 0}</span></div>
            </div>
          </div>

          <div className="bg-zinc-950/85 border border-zinc-800 p-6 rounded-3xl space-y-4 shadow-xl backdrop-blur xl:col-span-1">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Palette className="w-5 h-5 text-fuchsia-400" /> Theme & Background
            </h3>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Theme Preset</label>
              <select
                value={theme.preset}
                onChange={(e) => setTheme({ ...theme, preset: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs"
              >
                <option value="spidey-neon">Spidey Neon · Blue / Red / Black</option>
                <option value="aurora-digital">Aurora Digital</option>
                <option value="neon-grid">Neon Grid</option>
                <option value="sunset-cyber">Sunset Cyber</option>
                <option value="matrix-wave">Matrix Wave</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Overlay Opacity</label>
              <input
                type="range"
                min="0.2"
                max="0.9"
                step="0.05"
                value={theme.overlayOpacity}
                onChange={(e) => setTheme({ ...theme, overlayOpacity: Number(e.target.value) })}
                className="w-full"
              />
              <div className="text-[11px] text-zinc-500 mt-1">{theme.overlayOpacity}</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Background Media (image/video up to 2GB)</label>
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadBackground(file);
                }}
                className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-white file:text-black hover:file:bg-zinc-200"
              />
              <div className="text-[11px] text-zinc-500 mt-2">Semua role akan melihat background ini di seluruh panel.</div>
            </div>

            {theme.backgroundUrl ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-400 font-mono break-all">
                Current media: {theme.backgroundUrl}
              </div>
            ) : null}

            <button onClick={saveTheme} disabled={saving} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 disabled:opacity-50">
              {saving ? "Saving..." : "Save Theme Permanently"}
            </button>
          </div>

          <div className="bg-zinc-950/85 border border-zinc-800 p-6 rounded-3xl space-y-4 shadow-xl backdrop-blur xl:col-span-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2"><HardDrive className="w-5 h-5 text-cyan-300" /> Cache Manager</h3>
              <button onClick={() => window.location.reload()} className="rounded-xl border border-zinc-700 px-3 py-2 text-[11px] font-bold text-zinc-300 hover:text-white"><RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Refresh</button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Server storage</div><div className="mt-1 font-mono text-sm text-white">{formatBytes(cache?.serverStorageBytes || 0)}</div></div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Backups</div><div className="mt-1 font-mono text-sm text-white">{formatBytes(cache?.backupBytes || 0)}</div></div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Temp files</div><div className="mt-1 font-mono text-sm text-amber-300">{cache?.temporaryFiles ?? 0}</div></div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Temp size</div><div className="mt-1 font-mono text-sm text-amber-300">{formatBytes(cache?.temporaryBytes || 0)}</div></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={cleaning} onClick={() => cleanCache("clean_temp")} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-200 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Clean temp</button>
              <button disabled={cleaning} onClick={() => cleanCache("clean_orphan")} className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-[11px] font-bold text-fuchsia-200 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Clean orphan</button>
              <button disabled={cleaning} onClick={() => cleanCache("clean_all")} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[11px] font-black text-black disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> {cleaning ? "Cleaning..." : "Clean all safe cache"}</button>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">Cleanup hanya berjalan pada allowlist storage BirdServer: temporary upload, runtime download, orphan server directory, dan backup file yang tidak direferensikan database. Tidak ada penghapusan global.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
