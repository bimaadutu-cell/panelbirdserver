"use client";

import React, { useState, useEffect } from "react";
import { Archive, Plus, Download, RefreshCw, Trash2, CheckCircle2 } from "lucide-react";
import { formatBytes } from "@/lib/utils";

interface BackupItem {
  id: string;
  name: string;
  fileSize: number;
  isSuccessful: boolean;
  createdAt: string;
}

export function BackupsView({ serverId }: { serverId: string }) {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [backupName, setBackupName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/backups`);
      const data = await res.json();
      if (data.success) {
        setBackups(data.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, [serverId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/backups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: backupName || "Manual Backup" }),
      });
      const data = await res.json();
      if (data.success) {
        setBackupName("");
        fetchBackups();
      } else {
        alert(data.error?.message || "Backup failed");
      }
    } catch {
      alert("Backup failed");
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (backupId: string) => {
    if (!confirm("Restoring this backup will replace current server files. Continue?")) return;
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/backups/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupId }),
      });
      const data = await res.json();
      if (data.success) {
        alert("Backup restored successfully!");
      } else {
        alert(data.error?.message || "Restore failed");
      }
    } catch {
      alert("Restore failed");
    }
  };

  const handleDelete = async (backupId: string) => {
    if (!confirm("Delete this backup permanently?")) return;
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/backups?backupId=${backupId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        fetchBackups();
      }
    } catch {
      alert("Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      {/* Create Backup Box */}
      <form onSubmit={handleCreate} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col sm:flex-row items-center gap-3">
        <input
          type="text"
          value={backupName}
          onChange={(e) => setBackupName(e.target.value)}
          placeholder="Backup name (e.g. Before Update)..."
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 w-full"
        />
        <button
          type="submit"
          disabled={creating}
          className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(255,255,255,0.3)]"
        >
          <Archive className="w-4 h-4" />
          {creating ? "Creating Archive..." : "Create Backup Now"}
        </button>
      </form>

      {/* Backup List Table */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Backup Name</th>
                <th className="p-3.5">Size</th>
                <th className="p-3.5">Created At</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500">Loading backups...</td>
                </tr>
              ) : backups.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500">No backups created yet.</td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id} className="hover:bg-zinc-900/50">
                    <td className="p-3.5 font-bold text-white flex items-center gap-2">
                      <Archive className="w-4 h-4 text-purple-400" />
                      {b.name}
                    </td>
                    <td className="p-3.5 font-mono">{formatBytes(b.fileSize)}</td>
                    <td className="p-3.5 font-mono text-[11px]">{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="p-3.5 text-right space-x-2">
                      <button
                        onClick={() => handleRestore(b.id)}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-700 text-xs"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => handleDelete(b.id)}
                        className="p-1 text-red-400 hover:bg-red-950/50 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
