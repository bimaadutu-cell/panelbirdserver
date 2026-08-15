"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { User, Lock, ShieldCheck, Check } from "lucide-react";

export default function AccountPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMe() {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (data.success) setUser(data.data.user);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadMe();
  }, []);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <User className="w-6 h-6 text-white" /> Account Profile Settings
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage profile details, credentials, and authentication
          </p>
        </div>

        <div className="grid grid-cols-1 max-w-2xl gap-6">
          <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" /> User Profile Information
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Username</label>
                <input
                  type="text"
                  readOnly
                  value={user?.username || ""}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Email Address</label>
                <input
                  type="email"
                  readOnly
                  value={user?.email || ""}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">System Role</label>
                <span className="inline-block px-3 py-1 rounded-lg bg-zinc-800 border border-zinc-700 font-bold uppercase text-white">
                  {user?.role}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
