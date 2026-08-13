"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Wallet, Plus, ArrowUpRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function ResellerBalancePage() {
  const [user, setUser] = useState<any>(null);
  const [resellerUsage, setResellerUsage] = useState<any>(null);
  const [topupAmount, setTopupAmount] = useState(100000);
  const [topupLoading, setTopupLoading] = useState(false);

  const fetchMe = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.success) {
        setUser(data.data.user);
        setResellerUsage(data.data.resellerUsage);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const handleTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopupLoading(true);

    try {
      const res = await fetch("/api/v1/reseller/balance/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(topupAmount) }),
      });
      const data = await res.json();
      if (data.success) {
        alert("Balance top-up successful!");
        fetchMe();
      } else {
        alert(data.error?.message || "Topup failed");
      }
    } catch {
      alert("Topup failed");
    } finally {
      setTopupLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="border-b border-zinc-800 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Wallet className="w-6 h-6 text-white" /> Reseller Balance & Top-Up
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage your reseller account wallet and deposit funds for customer order provisioning
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl space-y-3 shadow-xl">
            <span className="text-xs font-semibold text-zinc-400">Current Wallet Balance</span>
            <div className="text-3xl font-black text-emerald-400 font-mono">
              {formatCurrency(resellerUsage?.balance || 0)}
            </div>
            <p className="text-xs text-zinc-500">
              Funds are automatically deducted when provisioning server packages for customers.
            </p>
          </div>

          <form onSubmit={handleTopup} className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-white" /> Deposit Top-Up Funds
            </h3>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Amount (IDR Minor Units)</label>
              <input
                type="number"
                value={topupAmount}
                onChange={(e) => setTopupAmount(Number(e.target.value))}
                step={50000}
                required
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={topupLoading}
              className="w-full py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_12px_rgba(255,255,255,0.3)]"
            >
              Deposit Funds Now
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
