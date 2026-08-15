"use client";

import React, { useEffect, useState } from "react";
import { Cpu, HardDrive, Server as ServerIcon, Clock, Activity, ShieldCheck } from "lucide-react";
import { formatBytes } from "@/lib/utils";

interface ServerMetricsGaugeProps {
  serverId: string;
  memoryMb: number;
  cpuPercent: number;
  diskMb: number;
}

export function ServerMetricsGauge({
  serverId,
  memoryMb,
  cpuPercent,
  diskMb,
}: ServerMetricsGaugeProps) {
  const [metrics, setMetrics] = useState({
    status: "stopped",
    cpuPercent: 0,
    memoryBytes: 0,
    diskBytes: 0,
    uptimeSeconds: 0,
  });

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`/api/v1/servers/${serverId}/metrics`);
        const data = await res.json();
        if (data.success && data.data) {
          setMetrics(data.data);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000);
    return () => clearInterval(interval);
  }, [serverId]);

  const maxMemBytes = memoryMb * 1024 * 1024;
  const memUsagePercent = maxMemBytes > 0 ? Math.min(100, Math.round((metrics.memoryBytes / maxMemBytes) * 100)) : 0;

  const maxDiskBytes = diskMb * 1024 * 1024;
  const diskUsagePercent = maxDiskBytes > 0 ? Math.min(100, Math.round((metrics.diskBytes / maxDiskBytes) * 100)) : 0;

  const formatUptime = (sec: number) => {
    if (sec <= 0) return "Offline";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* CPU Usage Card */}
      <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-white" /> CPU Load
          </span>
          <span className="text-xs font-bold font-mono text-white">
            {metrics.cpuPercent}% / {cpuPercent}%
          </span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-200 ease-out shadow-[0_0_10px_rgba(255,255,255,0.8)]"
            style={{ width: `${Math.min(100, (metrics.cpuPercent / cpuPercent) * 100)}%` }}
          />
        </div>
      </div>

      {/* Memory Usage Card */}
      <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <ServerIcon className="w-4 h-4 text-white" /> RAM Usage
          </span>
          <span className="text-xs font-bold font-mono text-white">
            {formatBytes(metrics.memoryBytes)} / {memoryMb} MB
          </span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-200 ease-out shadow-[0_0_10px_rgba(255,255,255,0.8)]"
            style={{ width: `${memUsagePercent}%` }}
          />
        </div>
      </div>

      {/* Disk Storage Card */}
      <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 text-white" /> Disk Storage
          </span>
          <span className="text-xs font-bold font-mono text-white">
            {formatBytes(metrics.diskBytes)} / {diskMb} MB
          </span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-200 ease-out shadow-[0_0_10px_rgba(255,255,255,0.8)]"
            style={{ width: `${diskUsagePercent}%` }}
          />
        </div>
      </div>

      {/* Uptime Card */}
      <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-white" /> Server Uptime
          </span>
          <span className="text-xs font-bold font-mono text-emerald-400">
            {formatUptime(metrics.uptimeSeconds)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mt-2 font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" /> Container Runtime Isolated
        </div>
      </div>
    </div>
  );
}
