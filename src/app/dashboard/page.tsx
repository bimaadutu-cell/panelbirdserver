"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import Link from "next/link";
import {
  Server,
  Users,
  Shield,
  HardDrive,
  Cpu,
  Wallet,
  Play,
  Square,
  ArrowUpRight,
  Activity,
  Plus,
  Clock,
} from "lucide-react";
import { formatBytes, formatCurrency } from "@/lib/utils";

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [resellerUsage, setResellerUsage] = useState<any>(null);
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (meData.success) {
          setUser(meData.data.user);
          setResellerUsage(meData.data.resellerUsage);
        }

        const srvRes = await fetch("/api/v1/servers");
        const srvData = await srvRes.json();
        if (srvData.success) {
          setServers(srvData.data || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const activeServers = servers.filter((s) => s.status === "running").length;
  const stoppedServers = servers.filter((s) => s.status === "stopped").length;

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              Welcome back, {user?.username || "Operator"}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Birdserver V1 Management Dashboard • Role: <span className="text-white font-semibold uppercase">{user?.role}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {user?.role === "admin" ? (
              <Link
                href="/servers"
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,255,255,0.3)]"
              >
                <Plus className="w-4 h-4" /> Deploy Server
              </Link>
            ) : null}
          </div>
        </div>

        {/* ROLE 1: USER DASHBOARD */}
        {user?.role === "user" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400">Total Servers</span>
                  <Server className="w-5 h-5 text-white" />
                </div>
                <div className="text-2xl font-black text-white mt-2">{servers.length}</div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400">Running Servers</span>
                  <Play className="w-5 h-5 text-emerald-400 fill-emerald-400/20" />
                </div>
                <div className="text-2xl font-black text-emerald-400 mt-2">{activeServers}</div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400">Offline Servers</span>
                  <Square className="w-5 h-5 text-zinc-500" />
                </div>
                <div className="text-2xl font-black text-zinc-400 mt-2">{stoppedServers}</div>
              </div>
            </div>
          </div>
        )}

        {/* ROLE 2: RESELLER DASHBOARD */}
        {user?.role === "reseller" && resellerUsage && (
          <div className="space-y-6">
            {/* Quota & Usage Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
                <div className="text-xs font-semibold text-zinc-400 flex items-center justify-between">
                  <span>RAM Usage / Quota</span>
                  <Server className="w-4 h-4 text-white" />
                </div>
                <div className="text-xl font-bold text-white mt-2 font-mono">
                  {resellerUsage.ramUsedMb} MB / {resellerUsage.ramLimitMb} MB
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-white shadow-[0_0_8px_#ffffff]"
                    style={{ width: `${Math.min(100, (resellerUsage.ramUsedMb / resellerUsage.ramLimitMb) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
                <div className="text-xs font-semibold text-zinc-400 flex items-center justify-between">
                  <span>CPU Usage / Quota</span>
                  <Cpu className="w-4 h-4 text-white" />
                </div>
                <div className="text-xl font-bold text-white mt-2 font-mono">
                  {resellerUsage.cpuUsedPercent}% / {resellerUsage.cpuLimitPercent}%
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-white shadow-[0_0_8px_#ffffff]"
                    style={{ width: `${Math.min(100, (resellerUsage.cpuUsedPercent / resellerUsage.cpuLimitPercent) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
                <div className="text-xs font-semibold text-zinc-400 flex items-center justify-between">
                  <span>Customers</span>
                  <Users className="w-4 h-4 text-white" />
                </div>
                <div className="text-xl font-bold text-white mt-2 font-mono">
                  {resellerUsage.customersCount} / {resellerUsage.maxCustomers}
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
                <div className="text-xs font-semibold text-zinc-400 flex items-center justify-between">
                  <span>Reseller Balance</span>
                  <Wallet className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-xl font-bold text-emerald-400 mt-2 font-mono">
                  {formatCurrency(resellerUsage.balance)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROLE 3: ADMIN DASHBOARD */}
        {user?.role === "admin" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-zinc-400">Total Infrastructure Servers</div>
              <div className="text-2xl font-black text-white mt-2">{servers.length}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-zinc-400">Running Instances</div>
              <div className="text-2xl font-black text-emerald-400 mt-2">{activeServers}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-zinc-400">Cluster Nodes</div>
              <div className="text-2xl font-black text-white mt-2">1 Node Online</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-2xl">
              <div className="text-xs font-semibold text-zinc-400">System Status</div>
              <div className="text-2xl font-black text-white mt-2 flex items-center gap-1.5 text-emerald-400 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" /> 100% HEALTHY
              </div>
            </div>
          </div>
        )}

        {/* Server List Preview Table */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-white" /> Servers Infrastructure Overview
            </h2>
            <Link href="/servers" className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-semibold">
              View All <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
                <tr>
                  <th className="p-3.5">Identifier</th>
                  <th className="p-3.5">Server Name</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Allocated Specs</th>
                  <th className="p-3.5 text-right">Console</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {servers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-zinc-500 italic">
                      No servers deployed yet. Click "Deploy Server" to create your first server container!
                    </td>
                  </tr>
                ) : (
                  servers.map((s) => (
                    <tr key={s.id} className="hover:bg-zinc-900/50 transition-colors">
                      <td className="p-3.5 font-mono text-zinc-400 font-bold">{s.identifier}</td>
                      <td className="p-3.5 font-bold text-white">{s.name}</td>
                      <td className="p-3.5">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                          s.status === "running" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        }`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono text-zinc-400">
                        {s.memoryMb}MB RAM / {s.cpuPercent}% CPU / {s.diskMb}MB Disk
                      </td>
                      <td className="p-3.5 text-right">
                        <Link
                          href={`/servers/${s.id}`}
                          className="px-3 py-1.5 rounded-lg bg-white text-black font-bold text-xs hover:bg-zinc-200 transition-all inline-block"
                        >
                          Manage Server
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
