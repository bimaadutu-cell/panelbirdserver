"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Play, Square, RotateCw, Skull, Trash2, Send, Terminal, Circle, ScanQrCode } from "lucide-react";

interface ConsoleViewProps {
  serverId: string;
  serverStatus: string;
  onPowerAction: (action: "start" | "stop" | "restart" | "kill") => Promise<void>;
}

function isQrAsciiLine(line: string) {
  const trimmed = line.trimEnd();
  if (!trimmed) return false;
  if (trimmed.length < 18) return false;
  return /^[\s\u2580-\u259F\u25A0-\u25FF]+$/.test(trimmed);
}

export function ConsoleView({ serverId, serverStatus, onPowerAction }: ConsoleViewProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [loadingPower, setLoadingPower] = useState<string | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connectLogs = () => {
      eventSource = new EventSource(`/api/v1/servers/${serverId}/logs`);

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.line) {
            setLogs((prev) => [...prev.slice(-1200), data.line]);
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
      if (eventSource) eventSource.close();
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

    let currentGroup: { start: number; lines: string[] } | null = null;
    let bestGroup: string[] = [];

    filteredLogs.forEach((line, index) => {
      if (isQrAsciiLine(line)) {
        if (!currentGroup) currentGroup = { start: index, lines: [] };
        currentGroup.lines.push(line);
      } else if (currentGroup) {
        if (currentGroup.lines.length >= 10) {
          bestGroup = currentGroup.lines;
        }
        currentGroup = null;
      }
    });

    const trailingGroup = currentGroup as { start: number; lines: string[] } | null;
    if (trailingGroup && trailingGroup.lines.length >= 10) {
      bestGroup = trailingGroup.lines;
    }

    const visible = bestGroup.length
      ? filteredLogs.filter((line, index) => {
          const bestStart = filteredLogs.findIndex((_, i) => filteredLogs.slice(i, i + bestGroup.length).join("\n") === bestGroup.join("\n"));
          if (bestStart === -1) return true;
          return index < bestStart || index >= bestStart + bestGroup.length;
        })
      : filteredLogs;

    return {
      visibleLogs: visible,
      asciiQrLines: bestGroup,
      qrPayload: latestQrPayload,
    };
  }, [logs]);

  useEffect(() => {
    let active = true;
    if (!qrPayload) {
      setQrImageUrl(null);
      return;
    }

    QRCode.toDataURL(qrPayload, {
      margin: 1,
      width: 260,
      errorCorrectionLevel: "M",
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (active) setQrImageUrl(url);
      })
      .catch(() => {
        if (active) setQrImageUrl(null);
      });

    return () => {
      active = false;
    };
  }, [qrPayload]);

  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
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
    if (lower.includes("npm err") || lower.includes("error") || lower.includes("failed") || lower.includes("module_not_found")) {
      return "text-red-400";
    }
    if (lower.includes("npm warn") || lower.includes("warning") || lower.includes("notice")) {
      return "text-amber-300";
    }
    if (lower.includes("added ") || lower.includes("audited ") || lower.includes("found 0 vulnerabilities") || lower.includes("success") || lower.includes("running")) {
      return "text-emerald-400";
    }
    if (lower.startsWith("> ")) {
      return "text-cyan-300";
    }
    return "text-zinc-200";
  };

  const getStatusBadge = () => {
    switch (serverStatus) {
      case "running":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
            <Circle className="w-2 h-2 fill-emerald-400" />
            RUNNING
          </span>
        );
      case "stopped":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
            <Circle className="w-2 h-2 fill-zinc-500" />
            OFFLINE
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Circle className="w-2 h-2 fill-amber-400 animate-pulse" />
            {serverStatus.toUpperCase()}
          </span>
        );
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
          <button
            onClick={() => triggerPower("start")}
            disabled={serverStatus === "running" || loadingPower !== null}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-white transition-all shadow-[0_0_12px_rgba(255,255,255,0.25)]"
          >
            <Play className="w-3.5 h-3.5 fill-black" />
            START
          </button>
          <button
            onClick={() => triggerPower("stop")}
            disabled={serverStatus !== "running" || loadingPower !== null}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-40 transition-all"
          >
            <Square className="w-3.5 h-3.5" />
            STOP
          </button>
          <button
            onClick={() => triggerPower("restart")}
            disabled={serverStatus !== "running" || loadingPower !== null}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-40 transition-all"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loadingPower === "restart" ? "animate-spin" : ""}`} />
            RESTART
          </button>
          <button
            onClick={() => triggerPower("kill")}
            disabled={serverStatus !== "running" || loadingPower !== null}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-red-950/80 text-red-400 border border-red-800/80 hover:bg-red-900 disabled:opacity-40 transition-all"
          >
            <Skull className="w-3.5 h-3.5" />
            KILL
          </button>
        </div>
      </div>

      {(qrImageUrl || asciiQrLines.length > 0) && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 shadow-2xl">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
            <ScanQrCode className="h-5 w-5 text-emerald-400" />
            WhatsApp / Bot QR Scanner
          </div>
          <p className="mb-4 text-xs text-zinc-400">
            QR dirapikan oleh Birdserver agar tetap kecil/sedang, tidak menutupi console, dan tetap mudah dibaca saat discan.
          </p>

          {qrImageUrl ? (
            <div className="flex justify-center">
              <div className="rounded-2xl bg-white p-3 shadow-[0_0_24px_rgba(255,255,255,0.08)]">
                <img
                  src={qrImageUrl}
                  alt="Bot QR"
                  className="h-56 w-56 max-w-full rounded-lg object-contain sm:h-64 sm:w-64"
                />
              </div>
            </div>
          ) : asciiQrLines.length > 0 ? (
            <div className="overflow-auto rounded-2xl bg-white p-3 text-black">
              <pre className="mx-auto w-fit whitespace-pre text-[6px] leading-[6px] sm:text-[7px] sm:leading-[7px] font-mono">
                {asciiQrLines.join("\n")}
              </pre>
            </div>
          ) : null}
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
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-white focus:ring-0"
              />
              <span>Auto Scroll</span>
            </label>
            <button onClick={() => setLogs([])} className="p-1 hover:text-white transition-colors" title="Clear Console">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 font-mono text-xs leading-relaxed overflow-y-auto text-zinc-200 bg-black space-y-1 select-text">
          {visibleLogs.length === 0 ? (
            <div className="text-zinc-600 italic">Console output is empty. Press START to launch process.</div>
          ) : (
            visibleLogs.map((line, idx) => (
              <div key={idx} className={`whitespace-pre-wrap break-all hover:bg-zinc-900/40 px-1 rounded ${getLineClassName(line)}`}>
                {line}
              </div>
            ))
          )}
          <div ref={consoleEndRef} />
        </div>

        <form onSubmit={handleSendCommand} className="bg-zinc-900/80 border-t border-zinc-800 p-2.5 flex items-center gap-2">
          <span className="text-emerald-400 font-mono text-sm pl-2 font-bold">&gt;</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={serverStatus === "running" ? "Type command or input here (e.g. node index.js or npm start)..." : "Server is offline. Press START above first."}
            disabled={serverStatus !== "running"}
            className="flex-1 bg-transparent text-white font-mono text-xs focus:outline-none placeholder-zinc-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={serverStatus !== "running" || !command.trim()}
            className="px-3 py-1.5 rounded-lg bg-white text-black font-bold text-xs hover:bg-zinc-200 disabled:opacity-30 transition-all flex items-center gap-1"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
