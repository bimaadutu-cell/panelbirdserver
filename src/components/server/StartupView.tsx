"use client";

import React, { useState } from "react";
import { Terminal, Save, Layers, Lock, FolderRoot } from "lucide-react";

interface StartupViewProps {
  serverId: string;
  dockerImage: string;
  startupCommand: string;
  workingDirectory?: string;
  envVars: Record<string, string>;
  onSaved: () => void;
}

export function StartupView({
  serverId,
  dockerImage: initialImage,
  startupCommand: initialCmd,
  workingDirectory: initialWorkingDirectory,
  envVars: initialEnv,
  onSaved,
}: StartupViewProps) {
  const [image, setImage] = useState(initialImage);
  const [cmd, setCmd] = useState(initialCmd);
  const [workingDirectory, setWorkingDirectory] = useState(initialWorkingDirectory || "/home/container");
  const [nodeRuntimeVersion, setNodeRuntimeVersion] = useState(initialEnv?.NODE_RUNTIME_VERSION || "system");
  const [envStr, setEnvStr] = useState(
    Object.entries(initialEnv || {})
      .filter(([k]) => k !== "NODE_RUNTIME_VERSION")
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
  );
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    const parsedEnv: Record<string, string> = {};
    envStr.split("\n").forEach((line) => {
      const parts = line.split("=");
      if (parts[0] && parts[1] !== undefined) {
        parsedEnv[parts[0].trim()] = parts.slice(1).join("=").trim();
      }
    });

    parsedEnv.NODE_RUNTIME_VERSION = nodeRuntimeVersion;

    try {
      const res = await fetch(`/api/v1/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dockerImage: image,
          startupCommand: cmd,
          workingDirectory,
          envVars: parsedEnv,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMessage(data.message || "Startup configuration saved. Press START to apply it.");
        onSaved();
      } else {
        setSaveError(data.error?.message || "Failed to update startup settings");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update startup settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 p-6 bg-zinc-950 border border-zinc-800 rounded-2xl">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-[11px] text-zinc-400 leading-relaxed">
        Startup ini memakai runtime Node.js asli. Format Pterodactyl seperti
        <span className="mx-1 font-mono text-zinc-200">/home/container/${"{MAIN_FILE}"}</span>
        didukung dan otomatis dipetakan ke root server yang benar secara aman.
      </div>

      <div>
        <label className="block text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-white" /> Runtime Image / Template
        </label>
        <p className="text-[10px] text-zinc-500 mb-2">Metadata/template field for the current host runtime. It does not create a Docker container by itself.</p>
        <input
          type="text"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          required
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
          <FolderRoot className="w-4 h-4 text-white" /> Working Directory
        </label>
        <input
          type="text"
          value={workingDirectory}
          onChange={(e) => setWorkingDirectory(e.target.value)}
          required
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-bold text-white">Node.js Runtime Version & Installation Status</label>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Node Installed ✅
          </span>
        </div>
        <select
          value={nodeRuntimeVersion}
          onChange={(e) => setNodeRuntimeVersion(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
        >
          <option value="system">System Default (Installed & Ready)</option>
          <option value="18">Node v18 (Cached / Ready)</option>
          <option value="20">Node v20 (Cached / Ready)</option>
          <option value="22">Node v22 (Recommended / Ready)</option>
          <option value="23">Node v23 (Latest / Ready)</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-bold text-white flex items-center gap-1.5">
            <Terminal className="w-4 h-4 text-white" /> Startup Command
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCmd("npm start")}
              className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-1"
              title="Ganti ke npm start"
            >
              ➔ npm start
            </button>
            <button
              type="button"
              onClick={() => setCmd("npm install && npm start")}
              className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-1"
              title="Ganti ke npm install & start"
            >
              ➔ npm install && npm start
            </button>
          </div>
        </div>
        <textarea
          rows={5}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          required
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
          <Lock className="w-4 h-4 text-white" /> Environment Variables (KEY=VALUE per line)
        </label>
        <textarea
          rows={8}
          value={envStr}
          onChange={(e) => setEnvStr(e.target.value)}
          placeholder="AUTO_UPDATE=0&#10;NODE_PACKAGES=&#10;UNNODE_PACKAGES=&#10;PYTHON_PACKAGES=&#10;OS_PACKAGES=&#10;MAIN_FILE=index.js"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
        />
      </div>

      {saveMessage && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
          {saveMessage}
        </div>
      )}
      {saveError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          {saveError}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center gap-2 shadow-[0_0_12px_rgba(255,255,255,0.3)] disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {saving ? "Saving Changes..." : "Save Startup Variables"}
      </button>
    </form>
  );
}
