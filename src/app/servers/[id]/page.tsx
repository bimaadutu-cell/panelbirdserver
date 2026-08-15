"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { ServerMetricsGauge } from "@/components/server/ServerMetricsGauge";
import { ConsoleView } from "@/components/server/ConsoleView";
import { FileManagerView } from "@/components/server/FileManagerView";
import { BackupsView } from "@/components/server/BackupsView";
import { DatabasesView } from "@/components/server/DatabasesView";
import { SchedulesView } from "@/components/server/SchedulesView";
import { SubusersView } from "@/components/server/SubusersView";
import { StartupView } from "@/components/server/StartupView";
import {
  Terminal,
  Folder,
  Archive,
  Database,
  Clock,
  Users,
  Settings,
  Server,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

export default function ServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [user, setUser] = useState<any>(null);
  const [server, setServer] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<
    "console" | "files" | "backups" | "databases" | "schedules" | "subusers" | "startup"
  >("console");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [powerError, setPowerError] = useState<string | null>(null);
  const router = useRouter();

  const fetchServerDetails = async () => {
    try {
      const meRes = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      const meData = await meRes.json().catch(() => null);

      if (!meRes.ok || !meData?.success) {
        setLoadError(meData?.error?.message || "Session tidak valid. Silakan login kembali.");
        if (meRes.status === 401) router.replace("/");
        return;
      }

      setUser(meData.data.user);

      const srvRes = await fetch(`/api/v1/servers/${encodeURIComponent(id)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const srvData = await srvRes.json().catch(() => null);

      if (srvRes.ok && srvData?.success && srvData.data) {
        setServer(srvData.data);
        setLoadError(null);
      } else if (srvRes.status === 401) {
        setLoadError("Sesi login telah berakhir. Silakan login kembali.");
        router.replace("/");
      } else if (srvRes.status === 404) {
        // A real 404 means the resource is gone; keep the current UI if this
        // is only a background poll so a transient response cannot blank the page.
        if (!server) setServer(null);
        setLoadError("Server tidak ditemukan di database.");
      } else {
        // Never replace an already-rendered server with a transient polling error.
        // The next poll can recover automatically.
        setLoadError(
          srvData?.error?.message ||
          `Gagal memuat server (HTTP ${srvRes.status}).`
        );
      }
    } catch (err) {
      console.error("[Birdserver] server detail load failed:", err);
      setLoadError("Koneksi ke server gagal. Mencoba lagi...");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServerDetails();
    const interval = setInterval(fetchServerDetails, 3000);
    return () => clearInterval(interval);
  }, [id]);

  const handlePowerAction = async (action: "start" | "stop" | "restart" | "kill") => {
    setPowerError(null);
    try {
      const res = await fetch(`/api/v1/servers/${id}/power`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchServerDetails();
      } else {
        setPowerError(data.error?.message || "Power action failed");
      }
    } catch {
      setPowerError("Koneksi power action gagal. Silakan coba lagi.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent text-white flex items-center justify-center font-sans">
        <div className="text-zinc-500 italic text-sm">Loading Server Console...</div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="min-h-screen bg-transparent text-white flex items-center justify-center p-4 font-sans">
        <div className="text-center space-y-4 max-w-md">
          <div>
            <h2 className="text-xl font-bold text-white">
              {loadError === "Server tidak ditemukan di database." ? "Server Not Found" : "Unable to Open Server"}
            </h2>
            <p className="text-xs text-zinc-400 mt-2">{loadError || "Memuat server..."}</p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                fetchServerDetails();
              }}
              className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold"
            >
              Coba Lagi
            </button>
            <Link href="/servers" className="text-xs font-bold text-white underline">
              Back to Servers
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "console", label: "Console", icon: <Terminal className="w-4 h-4" /> },
    { id: "files", label: "File Manager", icon: <Folder className="w-4 h-4" /> },
    { id: "backups", label: "Backups", icon: <Archive className="w-4 h-4" /> },
    { id: "databases", label: "Databases", icon: <Database className="w-4 h-4" /> },
    { id: "schedules", label: "Schedules", icon: <Clock className="w-4 h-4" /> },
    { id: "subusers", label: "Subusers", icon: <Users className="w-4 h-4" /> },
    { id: "startup", label: "Startup", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-transparent text-white font-sans">
      <Sidebar user={user} />

      <main className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto">
        {/* Top Header Navigation */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div className="flex items-center space-x-3">
            <Link
              href="/servers"
              className="p-2 rounded-xl bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
                  {server.identifier}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                    server.status === "running"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}
                >
                  {server.status}
                </span>
              </div>
              <h1 className="text-2xl font-black text-white mt-1">{server.name}</h1>
            </div>
          </div>

          <div className="text-xs font-mono text-zinc-400 bg-zinc-950 border border-zinc-800 px-4 py-2 rounded-xl">
            Allocation: {server.allocation?.ip || "127.0.0.1"}:{server.allocation?.port || "25565"}
          </div>
        </div>

        {/* Live Gauges */}
        <ServerMetricsGauge
          serverId={server.id}
          memoryMb={server.memoryMb}
          cpuPercent={server.cpuPercent}
          diskMb={server.diskMb}
        />

        {/* Tabs Bar */}
        <div className="flex items-center space-x-1 border-b border-zinc-800 overflow-x-auto pb-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-150 ${
                  isActive
                    ? "bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {powerError && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
            {powerError}
          </div>
        )}

        {/* Tab Contents */}
        <div className="pt-2">
          {activeTab === "console" && (
            <ConsoleView
              serverId={server.id}
              serverStatus={server.status}
              onPowerAction={handlePowerAction}
            />
          )}

          {activeTab === "files" && <FileManagerView serverId={server.id} />}

          {activeTab === "backups" && <BackupsView serverId={server.id} />}

          {activeTab === "databases" && <DatabasesView serverId={server.id} />}

          {activeTab === "schedules" && <SchedulesView serverId={server.id} />}

          {activeTab === "subusers" && <SubusersView serverId={server.id} />}

          {activeTab === "startup" && (
            <StartupView
              serverId={server.id}
              dockerImage={server.dockerImage}
              startupCommand={server.startupCommand}
              workingDirectory={server.workingDirectory}
              envVars={server.envVars || {}}
              onSaved={fetchServerDetails}
            />
          )}
        </div>
      </main>
    </div>
  );
}
