import fs from "fs";
import path from "path";

export interface ThemeSettings {
  preset: "neon-grid" | "aurora-digital" | "sunset-cyber" | "matrix-wave";
  backgroundType: "none" | "image" | "video";
  backgroundUrl: string;
  overlayOpacity: number;
}

const STORAGE_DIR = path.join(process.cwd(), "storage", "system");
const SETTINGS_FILE = path.join(STORAGE_DIR, "theme-settings.json");
const THEME_MEDIA_DIR = path.join(process.cwd(), "public", "theme-media");

export const defaultThemeSettings: ThemeSettings = {
  preset: "aurora-digital",
  backgroundType: "none",
  backgroundUrl: "",
  overlayOpacity: 0.58,
};

export function ensureThemeStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(THEME_MEDIA_DIR, { recursive: true });
}

export function readThemeSettings(): ThemeSettings {
  ensureThemeStorage();
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultThemeSettings, null, 2), "utf-8");
    return defaultThemeSettings;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<ThemeSettings>;
    return {
      ...defaultThemeSettings,
      ...raw,
    };
  } catch {
    return defaultThemeSettings;
  }
}

export function writeThemeSettings(settings: Partial<ThemeSettings>) {
  ensureThemeStorage();
  const merged = {
    ...readThemeSettings(),
    ...settings,
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export function saveThemeMedia(fileName: string, buffer: Buffer) {
  ensureThemeStorage();
  const ext = path.extname(fileName).toLowerCase();
  const targetName = `background${ext}`;
  const targetPath = path.join(THEME_MEDIA_DIR, targetName);

  for (const existing of fs.readdirSync(THEME_MEDIA_DIR)) {
    if (existing.startsWith("background.")) {
      try {
        fs.unlinkSync(path.join(THEME_MEDIA_DIR, existing));
      } catch {}
    }
  }

  fs.writeFileSync(targetPath, buffer);
  return `/theme-media/${targetName}`;
}
