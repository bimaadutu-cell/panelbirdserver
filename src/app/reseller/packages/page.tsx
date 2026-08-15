"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Package, Plus, Check } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function ResellerPackagesPage() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    async function loadMe() {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (data.success) setUser(data.data.user);
      } catch (err) {
        console.error(err);
      }
    }
    loadMe();
  }, []);

  const pkgList = [
    { id: "pkg_basic", name: "BOT BASIC", ram: "1 GB", cpu: "100%", disk: "5 GB", price: 50000 },
    { id: "pkg_pro", name: "BOT PRO", ram: "2 GB", cpu: "200%", disk: "10 GB", price: 100000 },
    { id: "pkg_ultra", name: "BOT ULTRA", ram: "4 GB", cpu: "400%", disk: "20 GB", price: 200000 },
  ];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Package className="w-6 h-6 text-white" /> Reseller Server Packages
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Available server specifications for customer provisioning
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {pkgList.map((p) => (
            <div key={p.id} className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl space-y-4 shadow-xl hover:border-zinc-600 transition-all">
              <h3 className="text-lg font-black text-white">{p.name}</h3>
              <div className="text-2xl font-black text-emerald-400 font-mono">{formatCurrency(p.price)} <span className="text-xs text-zinc-500 font-normal">/ 30 days</span></div>
              <ul className="space-y-2 text-xs text-zinc-300 font-mono border-t border-zinc-900 pt-3">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> RAM: {p.ram}</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> CPU: {p.cpu}</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Disk: {p.disk}</li>
              </ul>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
