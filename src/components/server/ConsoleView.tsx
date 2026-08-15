"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Play, Square, RotateCw, Skull, Trash2, Send, Terminal, Circle, ScanQrCode } from "lucide-react";

interface ConsoleViewProps {
  serverId: string;
  serverStatus: string;
  onPowerAction: (action: "start" | "stop" | "restart" | "kill") => Promise<void>;
}

function stripAnsi(value: string) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function isQrAsciiLine(line: string) {
  const raw = line.trimEnd();
  const stripped = stripAnsi(raw).trimEnd();
  if (!raw && !stripped) return false;
  if (raw.includes("\x1b[") && stripped.length === 0) return true;
  if (stripped.length < 18) return false;
  return /^[\s\u2580-\u259F\u25A0-\u25FF]+$/.test(stripped);
}

function parseUnicodeQrToSvg(lines: string[]) {
  const cleaned = lines.map((line) => stripAnsi(line));
  const rows: number[][] = [];

  for (const line of cleaned) {
    const rowTop: number[] = [];
    const rowBottom: number[] = [];

    for (const char of line) {
      switch (char) {
        case "█":
        case "■":
          rowTop.push(1);
          rowBottom.push(1);
          break;
        case "▀":
          rowTop.push(1);
          rowBottom.push(0);
          break;
        case "▄":
          rowTop.push(0);
          rowBottom.push(1);
          break;
        default:
          rowTop.push(0);
          rowBottom.push(0);
          break;
      }
    }

    if (rowTop.some(Boolean) || rowBottom.some(Boolean)) {
      rows.push(rowTop, rowBottom);
    }
  }

  if (!rows.length) return null;
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill(0)]);
  const scale = 6;
  const svgRects: string[] = [];

  normalized.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell) {
        svgRects.push(`<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="#111827" />`);
      }
    });
  });

  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${normalized.length * scale}" viewBox="0 0 ${width * scale} ${normalized.length * scale}"><rect width="100%" height="100%" fill="white"/>${svgRects.join("")}</svg>`
  )}`;
}

export function ConsoleView({ serverId, serverStatus, onPowerAction }: ConsoleViewProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [loadingPower, setLoadingPower] = useState<string | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const pendingLogsRef = useRef<string[]>([]);
  const logFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connectLogs = () => {
      eventSource = new EventSource(`/api/v1/servers/${serverId}/logs`);

      eventSource.onopen = () => setIsConnected(true);
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (!data.line) return;

          pendingLogsRef.current.push(String(data.line));
          if (!logFlushTimerRef.current) {
            logFlushTimerRef.current = setTimeout(() => {
              const batch = pendingLogsRef.current.splice(0);
              logFlushTimerRef.current = null;
              if (batch.length) {
                setLogs((prev) => [...prev, ...batch].slice(-600));
              }
            }, 100);
          }
        } catch (e) {
          console.error("Error parsing log line:", e);
        }
      };
      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource?.close();
        setTimeout(connectLogs, 3000);
      };
    };

    connectLogs();
    return () => {
      eventSource?.close();
      if (logFlushTimerRef.current) {
        clearTimeout(logFlushTimerRef.current);
        logFlushTimerRef.current = null;
      }
      pendingLogsRef.current = [];
    };
  }, [serverId]);

  const { visibleLogs, asciiQrLines, qrPayload } = useMemo(() => {
    let latestQrPayload: string | null = null;
    const filteredLogs: string[] = [];

    for (const line of logs) {
      if (line.startsWith("BIRDSERVER_QR:")) {
        latestQrPayload = line.slice("BIRDSERVER_QR:".length).trim();
        continue;
      }
      filteredLogs.push(line);
    }

    let currentGroup: { start: number; end: number; lines: string[] } | null = null;
    let bestGroup: { start: number; end: number; lines: string[] } | null = null;

    filteredLogs.forEach((line, index) => {
      if (isQrAsciiLine(line)) {
        if (!currentGroup) currentGroup = { start: index, end: index, lines: [] };
        currentGroup.lines.push(line);
        currentGroup.end = index;
      } else if (currentGroup) {
        if (currentGroup.lines.length >= 6) bestGroup = currentGroup;
        currentGroup = null;
      }
    });

    const trailingGroup = currentGroup as { start: number; end: number; lines: string[] } | null;
    if (trailingGroup && trailingGroup.lines.length >= 6) bestGroup = trailingGroup;

    const bestStart = bestGroup ? bestGroup.start : -1;
    const bestEnd = bestGroup ? bestGroup.end : -1;
    const bestLines = bestGroup ? bestGroup.lines : [];

    const visible = bestGroup ? filteredLogs.filter((_, index) => index < bestStart || index > bestEnd) : filteredLogs;
    return { visibleLogs: visible, asciiQrLines: bestLines, qrPayload: latestQrPayload };
  }, [logs]);

  useEffect(() => {
    let active = true;

    if (qrPayload) {
      QRCode.toDataURL(qrPayload, {
        margin: 1,
        width: 320,
        errorCorrectionLevel: "M",
        color: { dark: "#111827", light: "#ffffff" },
      })
        .then((url) => active && setQrImageUrl(url))
        .catch(() => active && setQrImageUrl(null));
      return () => {
        active = false;
      };
    }

    if (asciiQrLines.length) {
      setQrImageUrl(parseUnicodeQrToSvg(asciiQrLines));
      return;
    }

    setQrImageUrl(null);
    return;
  }, [qrPayload, asciiQrLines]);

  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [visibleLogs, autoScroll]);

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    const cmdToSend = command;
    setCommand("");

    try {
      await fetch(`/api/v1/servers/${serverId}/console`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmdToSend }),
      });
    } catch (err) {
      console.error("Failed to send command:", err);
    }
  };

  const handleClearLogs = async () => {
    setClearingLogs(true);
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/logs/clear`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLogs([]);
        setQrImageUrl(null);
      } else {
        alert(data.error?.message || "Failed to clear logs");
      }
    } catch {
      alert("Failed to clear logs");
    } finally {
      setClearingLogs(false);
    }
  };

  const triggerPower = async (action: "start" | "stop" | "restart" | "kill") => {
    setLoadingPower(action);
    try {
      await onPowerAction(action);
    } finally {
      setLoadingPower(null);
    }
  };

  const getLineClassName = (line: string) => {
    const lower = line.toLowerCase();
    if (lower.includes("npm err") || lower.includes("error") || lower.includes("failed") || lower.includes("module_not_found")) return "text-red-400";
    if (lower.includes("npm warn") || lower.includes("warning") || lower.includes("notice")) return "text-amber-300";
    if (lower.includes("added ") || lower.includes("audited ") || lower.includes("found 0 vulnerabilities") || lower.includes("success") || lower.includes("running")) return "text-emerald-400";
    if (lower.startsWith("> ")) return "text-cyan-300";
    return "text-zinc-200";
  };

  const getStatusBadge = () => {
    switch (serverStatus) {
      case "running":
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]"><Circle className="w-2 h-2 fill-emerald-400" />RUNNING</span>;
      case "stopped":
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700"><Circle className="w-2 h-2 fill-zinc-500" />OFFLINE</span>;
      default:
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"><Circle className="w-2 h-2 fill-amber-400 animate-pulse" />{serverStatus.toUpperCase()}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl">
        <div className="flex items-center space-x-3">
          <Terminal className="w-6 h-6 text-white" />
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">Server Terminal Console</h2>
            <div className="flex items-center space-x-2 text-xs text-zinc-400 mt-0.5">
              <span>Status:</span>
              {getStatusBadge()}
              <span className="text-zinc-600">|</span>
              <span className="flex items-center gap-1 font-mono">
                <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400 shadow-[0_0_8px_#10b981]" : "bg-red-500"}`} />
                {isConnected ? "LIVE LOG STREAM ACTIVE" : "RECONNECTING..."}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 w-full md:w-auto">
          <button onClick={() => triggerPower("start")} disabled={serverStatus === "running" || loadingPower !== null} className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-white transition-all shadow-[0_0_12px_rgba(255,255,255,0.25)]"><Play className="w-3.5 h-3.5 fill-black" />START</button>
          <button onClick={() => triggerPower("stop")} disabled={serverStatus !== "running" || loadingPower !== null} className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-40 transition-all"><Square className="w-3.5 h-3.5" />STOP</button>
          <button onClick={() => triggerPower("restart")} disabled={serverStatus !== "running" || loadingPower !== null} className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-40 transition-all"><RotateCw className={`w-3.5 h-3.5 ${loadingPower === "restart" ? "animate-spin" : ""}`} />RESTART</button>
          <button onClick={() => triggerPower("kill")} disabled={serverStatus !== "running" || loadingPower !== null} className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-red-950/80 text-red-400 border border-red-800/80 hover:bg-red-900 disabled:opacity-40 transition-all"><Skull className="w-3.5 h-3.5" />KILL</button>
        </div>
      </div>

      {qrImageUrl && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 shadow-2xl">
          <div className="mx-auto w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_25px_80px_rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-zinc-800">Birdserver</div>
                <div className="mt-1 text-lg font-black text-zinc-950">WhatsApp Login QR</div>
                <div className="mt-1 text-[11px] text-zinc-500">Scan via WhatsApp &gt; Perangkat Tertaut &gt; Tautkan Perangkat</div>
              </div>
              <div className="rounded-2xl bg-zinc-950 px-3 py-2 text-[11px] font-bold text-white">WA QR</div>
            </div>

            <div className="px-5 pb-5 pt-4">
              <div className="mb-4 rounded-2xl bg-zinc-100 px-4 py-3 text-center text-xs font-medium text-zinc-600">QR dirapikan Birdserver agar tetap jelas, medium, dan tidak menutupi console utama.</div>
              <div className="flex justify-center">
                <div className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-inner">
                  <img src={qrImageUrl} alt="Bot QR" className="h-64 w-64 max-w-full rounded-xl object-contain sm:h-72 sm:w-72" />
                </div>
              </div>
              <div className="mt-4 text-center text-[11px] text-zinc-500">Jika QR expired, tunggu bot menghasilkan QR baru lalu scan ulang.</div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-black border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[520px]">
        <div className="bg-zinc-900/90 border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center space-x-2 font-mono">
            <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            <span className="ml-2 text-zinc-300 font-semibold">container-tty / root@birdserver</span>
          </div>

          <div className="flex items-center space-x-3">
            <label className="flex items-center space-x-1.5 cursor-pointer text-zinc-400 hover:text-white select-none">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="rounded border-zinc-700 bg-zinc-800 text-white focus:ring-0" />
              <span>Auto Scroll</span>
            </label>
            <button onClick={handleClearLogs} disabled={clearingLogs} className="p-1 hover:text-white transition-colors disabled:opacity-50" title="Clear Console Permanently">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 font-mono text-xs leading-relaxed overflow-y-auto text-zinc-200 bg-black space-y-1 select-text">
          {visibleLogs.length === 0 ? <div className="text-zinc-600 italic">Console output is empty. Press START to launch process.</div> : visibleLogs.map((line, idx) => <div key={idx} className={`whitespace-pre-wrap break-all hover:bg-zinc-900/40 px-1 rounded ${getLineClassName(line)}`}>{line}</div>)}
          <div ref={consoleEndRef} />
        </div>

        <form onSubmit={handleSendCommand} className="bg-zinc-900/80 border-t border-zinc-800 p-2.5 flex items-center gap-2">
          <span className="text-emerald-400 font-mono text-sm pl-2 font-bold">&gt;</span>
          <input type="text" value={command} onChange={(e) => setCommand(e.target.value)} placeholder={serverStatus === "running" ? "Type command or input here (e.g. npm install baileys && npm start)..." : "Server is offline. Press START above first."} disabled={serverStatus !== "running"} className="flex-1 bg-transparent text-white font-mono text-xs focus:outline-none placeholder-zinc-600 disabled:opacity-50" />
          <button type="submit" disabled={serverStatus !== "running" || !command.trim()} className="px-3 py-1.5 rounded-lg bg-white text-black font-bold text-xs hover:bg-zinc-200 disabled:opacity-30 transition-all flex items-center gap-1"><Send className="w-3.5 h-3.5" />Send</button>
        </form>
      </div>
    </div>
  );
}
