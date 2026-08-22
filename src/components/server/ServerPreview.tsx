"use client";

import { useEffect, useState } from "react";
import { Play, Radio } from "lucide-react";

type Theme = {
  backgroundType?: "none" | "image" | "video";
  backgroundUrl?: string;
};

export function ServerPreview({ serverName, status }: { serverName: string; status: string }) {
  const [theme, setTheme] = useState<Theme>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/theme", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && payload?.success && payload.data) setTheme(payload.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const mediaUrl = theme.backgroundUrl || "";
  const hasVideo = theme.backgroundType === "video" && mediaUrl;
  const hasImage = theme.backgroundType === "image" && mediaUrl;

  return (
    <section className="relative isolate min-h-44 overflow-hidden rounded-3xl border border-cyan-400/20 bg-zinc-950 shadow-[0_0_48px_rgba(34,211,238,0.08)]">
      {hasVideo ? (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-55"
          src={mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={`${serverName} admin-configured video preview`}
        />
      ) : hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="absolute inset-0 h-full w-full object-cover opacity-45" src={mediaUrl} alt="" />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(34,211,238,0.22),transparent_34%),linear-gradient(120deg,rgba(5,7,13,0.94),rgba(5,7,13,0.55),rgba(127,29,29,0.66))]" />
      <div className="relative flex min-h-44 items-end justify-between gap-5 p-6 md:p-8">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200"><Radio className="h-3.5 w-3.5" /> Live runtime preview</div>
          <h2 className="text-2xl font-black tracking-tight text-white md:text-3xl">{serverName}</h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-zinc-300">Admin-configured media is delivered as a browser stream. The panel does not load the complete video into application memory.</p>
        </div>
        <div className="hidden items-center gap-2 rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-[11px] font-semibold text-white backdrop-blur md:flex"><Play className="h-4 w-4 text-cyan-300" /> {status}</div>
      </div>
    </section>
  );
}
