"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Activity } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function ResellerTransactionsPage() {
  const [user, setUser] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) setUser(meData.data.user);

        const txRes = await fetch("/api/v1/reseller/transactions");
        const txData = await txRes.json();
        if (txData.success) setTransactions(txData.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
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
            <Activity className="w-6 h-6 text-white" /> Financial Transaction History
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Audit logs of wallet top-ups, customer deductions, and refunds
          </p>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Transaction Type</th>
                <th className="p-3.5">Amount</th>
                <th className="p-3.5">Description</th>
                <th className="p-3.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500">Loading transactions...</td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500 italic">No transaction history found.</td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-zinc-900/50">
                    <td className="p-3.5 font-bold uppercase font-mono text-white">{tx.type}</td>
                    <td className={`p-3.5 font-mono font-bold ${tx.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="p-3.5 text-zinc-300">{tx.description}</td>
                    <td className="p-3.5 font-mono text-[11px] text-zinc-500">
                      {new Date(tx.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
