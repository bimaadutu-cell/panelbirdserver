"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Workflow } from "lucide-react";

interface Job {
  id: string;
  kind: string;
  status: string;
  phase: string;
  progress: number;
  pid?: number | null;
  lastOutput?: string | null;
  errorCode?: string | null;
  updatedAt?: string;
}

export function ServerJobsPanel({ serverId }: { serverId: string }) {
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/servers/${encodeURIComponent(serverId)}/jobs`, { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && payload?.success) {
          const active = (payload.data as Job[]).find((item) => item.status === "running" || item.status === "queued") || payload.data?.[0] || null;
          setJob(active);
        }
      } catch {
        // Job telemetry is supplementary and must not blank the server page.
      }
    };
    load();
    const interval = setInterval(load, 2_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverId]);

  if (!job) return null;
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  const active = job.status === "running" || job.status === "queued";
  const failed = job.status === "failed";

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-400"><Workflow className="h-4 w-4 text-cyan-300" /> Runtime job · {job.kind}</div>
        <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase ${failed ? "text-red-300" : active ? "text-amber-300" : "text-emerald-300"}`}>
          {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : failed ? <CircleAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {job.status}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500"><span>{job.phase}</span><span className="font-mono text-white">{progress}%</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full rounded-full transition-[width] duration-500 ${failed ? "bg-red-400" : active ? "bg-cyan-300" : "bg-emerald-400"}`} style={{ width: `${progress}%` }} /></div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-600"><span>Job ID {job.id}</span>{job.pid ? <span>PID {job.pid}</span> : null}{job.errorCode ? <span className="text-red-300">{job.errorCode}</span> : null}</div>
      {failed && job.lastOutput ? <pre className="mt-3 max-h-24 overflow-auto rounded-xl border border-red-500/20 bg-red-500/5 p-3 font-mono text-[10px] leading-relaxed text-red-200">{job.lastOutput}</pre> : null}
    </section>
  );
}
