"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, HardDrive, Network, Server as ServerIcon, ShieldCheck } from "lucide-react";
import { formatBytes } from "@/lib/utils";

interface ServerMetricsGaugeProps {
  serverId: string;
  memoryMb: number;
  cpuPercent: number;
  diskMb: number;
}

type Metrics = {
  status: string;
  cpuPercent: number;
  memoryBytes: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeSeconds: number;
};

type Point = { value: number; label: string };

const emptyMetrics: Metrics = {
  status: "stopped",
  cpuPercent: 0,
  memoryBytes: 0,
  diskBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
  uptimeSeconds: 0,
};

function Sparkline({ points, color }: { points: Point[]; color: string }) {
  const path = useMemo(() => {
    if (!points.length) return "";
    const max = Math.max(1, ...points.map((point) => point.value));
    return points
      .map((point, index) => {
        const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
        const y = 30 - (point.value / max) * 25;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);

  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-9 w-full opacity-80" aria-hidden="true">
      <path d="M0,30 L100,30" stroke="currentColor" strokeOpacity="0.16" strokeWidth="0.6" />
      {path ? <path d={path} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  percent,
  points,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  percent: number | null;
  points: Point[];
  color: string;
}) {
  const safePercent = percent === null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-[0_0_24px_rgba(0,0,0,0.18)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          {icon}
          {label}
        </span>
        <span className="font-mono text-xs font-bold text-white">{value}</span>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        {safePercent === null ? null : <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${safePercent}%`, backgroundColor: color }} />}
      </div>
      <Sparkline points={points} color={color} />
      <div className="mt-1 text-[10px] text-zinc-500">{detail}</div>
    </div>
  );
}

export function ServerMetricsGauge({ serverId, memoryMb, cpuPercent, diskMb }: ServerMetricsGaugeProps) {
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [history, setHistory] = useState<{ cpu: Point[]; memory: Point[]; disk: Point[] }>({ cpu: [], memory: [], disk: [] });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`/api/v1/servers/${encodeURIComponent(serverId)}/metrics`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled || !data.success || !data.data) return;
        const next = { ...emptyMetrics, ...data.data } as Metrics;
        setMetrics(next);
        setLastUpdated(new Date());
        const label = new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
        setHistory((previous) => ({
          cpu: [...previous.cpu, { value: next.cpuPercent, label }].slice(-30),
          memory: [...previous.memory, { value: next.memoryBytes, label }].slice(-30),
          disk: [...previous.disk, { value: next.diskBytes, label }].slice(-30),
        }));
      } catch {
        // A transient metrics failure should not blank the last good snapshot.
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverId]);

  const maxMemBytes = Math.max(0, memoryMb * 1024 * 1024);
  const maxDiskBytes = Math.max(0, diskMb * 1024 * 1024);
  const memUsagePercent = maxMemBytes > 0 ? (metrics.memoryBytes / maxMemBytes) * 100 : null;
  const diskUsagePercent = maxDiskBytes > 0 ? (metrics.diskBytes / maxDiskBytes) * 100 : null;
  const formatUptime = (sec: number) => {
    if (sec <= 0) return "Offline";
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    return `${days ? `${days}d ` : ""}${hours}h ${minutes}m ${seconds}s`;
  };

  return (
    <section className="space-y-3" aria-label="Live server resources">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Cpu className="h-3.5 w-3.5 text-cyan-300" />} label="CPU load" value={`${metrics.cpuPercent.toFixed(1)}% / ${cpuPercent}%`} detail="Process group usage on host" percent={cpuPercent > 0 ? (metrics.cpuPercent / cpuPercent) * 100 : null} points={history.cpu} color="#22d3ee" />
        <MetricCard icon={<ServerIcon className="h-3.5 w-3.5 text-fuchsia-300" />} label="RAM usage" value={`${formatBytes(metrics.memoryBytes)} / ${memoryMb} MB`} detail="Resident memory of runtime descendants" percent={memUsagePercent} points={history.memory} color="#e879f9" />
        <MetricCard icon={<HardDrive className="h-3.5 w-3.5 text-amber-300" />} label="Disk usage" value={`${formatBytes(metrics.diskBytes)} / ${diskMb} MB`} detail="Server directory, excluding runtime cache" percent={diskUsagePercent} points={history.disk} color="#fbbf24" />
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-[0_0_24px_rgba(0,0,0,0.18)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500"><Network className="h-3.5 w-3.5 text-emerald-300" /> Network</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${metrics.status === "running" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-zinc-500"}`}>{metrics.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div><div className="text-zinc-600">RX</div><div className="text-emerald-300">{formatBytes(metrics.networkRxBytes)}</div></div>
            <div><div className="text-zinc-600">TX</div><div className="text-emerald-300">{formatBytes(metrics.networkTxBytes)}</div></div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-zinc-500"><ShieldCheck className="h-3 w-3 text-zinc-600" /> Network is host/container scope</div>
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-600"><Activity className="h-3 w-3" /> Uptime {formatUptime(metrics.uptimeSeconds)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between px-1 text-[10px] text-zinc-600">
        <span>Telemetry sampled every 2 seconds; charts retain the last 30 samples.</span>
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for telemetry"}</span>
      </div>
    </section>
  );
}
