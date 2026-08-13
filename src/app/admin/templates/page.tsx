"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Layers } from "lucide-react";

export default function AdminTemplatesPage() {
  const [user, setUser] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const tRes = await fetch("/api/v1/admin/templates");
        const tData = await tRes.json();
        if (tData.success) setTemplates(tData.data || []);
      } catch (err) {
        console.error(err);
      }
    }
    loadData();
  }, []);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-white" /> Egg Templates Directory
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Pre-configured Docker application environments (Node.js, Python, WhatsApp Bot, Telegram Bot, etc.)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl space-y-3 shadow-xl">
              <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-bold text-white uppercase">
                {t.category}
              </span>
              <h3 className="text-base font-bold text-white">{t.name}</h3>
              <p className="text-xs text-zinc-400">{t.description}</p>
              <div className="pt-2 border-t border-zinc-900 font-mono text-[11px] text-zinc-500">
                <div>Image: <span className="text-zinc-300">{t.dockerImage}</span></div>
                <div>Cmd: <span className="text-emerald-400">{t.startupCmd}</span></div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
