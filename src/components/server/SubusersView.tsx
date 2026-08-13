"use client";

import React, { useState, useEffect } from "react";
import { Users, Plus, Trash2, ShieldCheck } from "lucide-react";

interface SubuserItem {
  id: string;
  userId: string;
  permissions: string[];
}

export function SubusersView({ serverId }: { serverId: string }) {
  const [subusers, setSubusers] = useState<SubuserItem[]>([]);
  const [email, setEmail] = useState("");

  const fetchSubusers = async () => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/subusers`);
      const data = await res.json();
      if (data.success) setSubusers(data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchSubusers();
  }, [serverId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/subusers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          permissions: ["console.read", "console.write", "files.read", "files.write", "server.start", "server.stop"],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEmail("");
        fetchSubusers();
      } else {
        alert(data.error?.message || "Failed to add subuser");
      }
    } catch {
      alert("Error adding subuser");
    }
  };

  const handleDelete = async (subId: string) => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/subusers?subId=${subId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) fetchSubusers();
    } catch {
      alert("Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col sm:flex-row items-center gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="User email address..."
          required
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none w-full"
        />
        <button
          type="submit"
          className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Grant Subuser Access
        </button>
      </form>

      <div className="space-y-3">
        {subusers.map((sub) => (
          <div key={sub.id} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-between">
            <div>
              <div className="font-bold text-white text-xs flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> Subuser ID: {sub.userId}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {sub.permissions.map((p) => (
                  <span key={p} className="px-2 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 font-mono">
                    {p}
                  </span>
                ))}
              </div>
            </div>
            <button onClick={() => handleDelete(sub.id)} className="p-1.5 text-red-400 hover:bg-red-950/50 rounded">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
