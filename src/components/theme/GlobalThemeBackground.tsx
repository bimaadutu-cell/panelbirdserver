"use client";

import { useEffect, useMemo, useState } from "react";

type ThemeSettings = {
  preset: "neon-grid" | "aurora-digital" | "sunset-cyber" | "matrix-wave";
  backgroundType: "none" | "image" | "video";
  backgroundUrl: string;
  overlayOpacity: number;
};

const defaultSettings: ThemeSettings = {
  preset: "aurora-digital",
  backgroundType: "none",
  backgroundUrl: "",
  overlayOpacity: 0.58,
};

export function GlobalThemeBackground() {
  const [settings, setSettings] = useState<ThemeSettings>(defaultSettings);

  useEffect(() => {
    let mounted = true;
    fetch("/api/public/theme")
      .then((res) => res.json())
      .then((data) => {
        if (mounted && data.success) setSettings(data.data);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const presetClass = useMemo(() => {
    switch (settings.preset) {
      case "neon-grid":
        return "from-cyan-500/35 via-fuchsia-500/25 to-blue-500/35";
      case "sunset-cyber":
        return "from-orange-500/35 via-pink-500/25 to-purple-500/35";
      case "matrix-wave":
        return "from-emerald-500/30 via-lime-500/20 to-cyan-500/30";
      default:
        return "from-sky-500/30 via-violet-500/20 to-fuchsia-500/30";
    }
  }, [settings.preset]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {settings.backgroundType === "video" && settings.backgroundUrl ? (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          src={settings.backgroundUrl}
        />
      ) : null}

      {settings.backgroundType === "image" && settings.backgroundUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${settings.backgroundUrl})` }}
        />
      ) : null}

      <div
        className={`absolute inset-0 bg-gradient-to-br ${presetClass}`}
        style={{ opacity: settings.overlayOpacity }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.15),transparent_28%),linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.85))]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
    </div>
  );
}
