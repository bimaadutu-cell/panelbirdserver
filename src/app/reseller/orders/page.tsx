"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { ShoppingCart, Plus, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function ResellerOrdersPage() {
  const [user, setUser] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Order Modal
  const [showModal, setShowModal] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [serverName, setServerName] = useState("");
  const [placing, setPlacing] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      if (meData.success) setUser(meData.data.user);

      const ordRes = await fetch("/api/v1/reseller/orders");
      const ordData = await ordRes.json();
      if (ordData.success) setOrders(ordData.data || []);

      const custRes = await fetch("/api/v1/reseller/customers");
      const custData = await custRes.json();
      if (custData.success) setCustomers(custData.data || []);

      const pkgRes = await fetch("/api/v1/admin/templates"); // or packages API
      setPackages([
        { id: "pkg_basic", name: "BOT BASIC (1GB RAM / 100% CPU)", price: 50000 },
        { id: "pkg_pro", name: "BOT PRO (2GB RAM / 200% CPU)", price: 100000 },
        { id: "pkg_ultra", name: "BOT ULTRA (4GB RAM / 400% CPU)", price: 200000 },
      ]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlacing(true);

    try {
      const res = await fetch("/api/v1/reseller/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, packageId, serverName }),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setServerName("");
        fetchOrders();
      } else {
        alert(data.error?.message || "Order placement failed");
      }
    } catch {
      alert("Order placement failed");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <ShoppingCart className="w-6 h-6 text-white" /> Reseller Order Provisioning
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Automated server provisioning and client package orders
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-2 text-xs text-zinc-400">
            Provision server baru dipusatkan di panel admin.
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
              <tr>
                <th className="p-3.5">Order ID</th>
                <th className="p-3.5">Customer ID</th>
                <th className="p-3.5">Amount</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">Loading orders...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500 italic">No orders recorded yet.</td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-zinc-900/50">
                    <td className="p-3.5 font-mono text-white font-bold">{o.id}</td>
                    <td className="p-3.5 font-mono text-zinc-400">{o.customerId}</td>
                    <td className="p-3.5 font-mono text-emerald-400 font-bold">{formatCurrency(o.amount)}</td>
                    <td className="p-3.5">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {o.status}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-zinc-500">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* New Order Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
              <h3 className="text-base font-bold text-white">Place New Order & Deploy Server</h3>
              <form onSubmit={handlePlaceOrder} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Select Customer</label>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="">-- Choose Customer --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.username} ({c.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Select Package</label>
                  <select
                    value={packageId}
                    onChange={(e) => setPackageId(e.target.value)}
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="">-- Choose Package --</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} - {formatCurrency(p.price)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Server Name</label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="Customer WhatsApp Bot Server"
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={placing}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200"
                  >
                    {placing ? "Provisioning..." : "Pay & Provision"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
