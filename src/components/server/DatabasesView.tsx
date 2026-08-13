"use client";

import React, { useState, useEffect } from "react";
import { Database, Plus, Trash2, Key, Server as ServerIcon } from "lucide-react";

interface DbItem {
  id: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  host: string;
  port: number;
}

export function DatabasesView({ serverId }: { serverId: string }) {
  const [databases, setDatabases] = useState<DbItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbName, setDbName] = useState("");

  const fetchDatabases = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/databases`);
      const data = await res.json();
      if (data.success) setDatabases(data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, [serverId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/databases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: dbName }),
      });
      const data = await res.json();
      if (data.success) {
        setDbName("");
        fetchDatabases();
      }
    } catch {
      alert("Database creation failed");
    }
  };

  const handleDelete = async (dbId: string) => {
    if (!confirm("Delete database?")) return;
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/databases?dbId=${dbId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) fetchDatabases();
    } catch {
      alert("Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col sm:flex-row items-center gap-3">
        <input
          type="text"
          value={dbName}
          onChange={(e) => setDbName(e.target.value)}
          placeholder="Database identifier name..."
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 w-full"
        />
        <button
          type="submit"
          className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Create Database
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {databases.map((db) => (
          <div key={db.id} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-3 relative">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" /> {db.dbName}
              </span>
              <button onClick={() => handleDelete(db.id)} className="p-1 text-red-400 hover:bg-red-950/50 rounded">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 text-xs font-mono text-zinc-300 bg-black/60 p-3 rounded-xl border border-zinc-800">
              <div>Host: <span className="text-white font-bold">{db.host}:{db.port}</span></div>
              <div>User: <span className="text-white font-bold">{db.dbUser}</span></div>
              <div>Pass: <span className="text-amber-400 font-bold">{db.dbPassword}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
