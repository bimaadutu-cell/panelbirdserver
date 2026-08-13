"use client";

import React, { useState, useEffect } from "react";
import { Clock, Plus, Trash2, Calendar } from "lucide-react";

interface ScheduleItem {
  id: string;
  name: string;
  cronExpression: string;
  actionType: string;
  payload: string;
  isActive: boolean;
}

export function SchedulesView({ serverId }: { serverId: string }) {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 * * * *");
  const [actionType, setActionType] = useState("power");
  const [payload, setPayload] = useState("restart");

  const fetchSchedules = async () => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/schedules`);
      const data = await res.json();
      if (data.success) setSchedules(data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, [serverId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cronExpression: cron, actionType, payload }),
      });
      const data = await res.json();
      if (data.success) {
        setName("");
        fetchSchedules();
      }
    } catch {
      alert("Failed to create schedule");
    }
  };

  const handleDelete = async (schedId: string) => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/schedules?schedId=${schedId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) fetchSchedules();
    } catch {
      alert("Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Clock className="w-4 h-4 text-white" /> Create Scheduled Task
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Schedule Task Name..."
            required
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
          />
          <input
            type="text"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="Cron (0 * * * *)"
            required
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
          />
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
          >
            <option value="power">Power Action</option>
            <option value="command">Console Command</option>
            <option value="backup">Create Backup</option>
          </select>
          <input
            type="text"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder="restart / npm start / backup name"
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add Schedule
        </button>
      </form>

      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs text-zinc-300">
          <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
            <tr>
              <th className="p-3.5">Task Name</th>
              <th className="p-3.5">Cron</th>
              <th className="p-3.5">Action</th>
              <th className="p-3.5 text-right">Delete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {schedules.map((s) => (
              <tr key={s.id} className="hover:bg-zinc-900/50">
                <td className="p-3.5 font-bold text-white">{s.name}</td>
                <td className="p-3.5 font-mono text-emerald-400">{s.cronExpression}</td>
                <td className="p-3.5 font-mono">{s.actionType}: {s.payload}</td>
                <td className="p-3.5 text-right">
                  <button onClick={() => handleDelete(s.id)} className="p-1 text-red-400 hover:bg-red-950/50 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
