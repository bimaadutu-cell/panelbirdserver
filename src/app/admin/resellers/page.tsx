"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Shield } from "lucide-react";

export default function AdminResellersPage() {
  const [user, setUser] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const uRes = await fetch("/api/v1/admin/users");
        const uData = await uRes.json();
        if (uData.success) {
          setUsersList((uData.data || []).filter((u: any) => u.role === "reseller"));
        }
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
            <Shield className="w-6 h-6 text-white" /> Admin Reseller Management
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Global reseller quota controls & balance allocations
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Reseller Username</th>
                <th className="p-3.5">Email</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {usersList.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-900/50">
                  <td className="p-3.5 font-bold text-white">{r.username}</td>
                  <td className="p-3.5 font-mono text-zinc-400">{r.email}</td>
                  <td className="p-3.5 font-mono text-emerald-400 font-bold uppercase">{r.status}</td>
                  <td className="p-3.5 font-mono text-zinc-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
