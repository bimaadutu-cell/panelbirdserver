import fs from "fs";
import path from "path";
import { once } from "events";

export type ThemePreset = "spidey-neon" | "neon-grid" | "aurora-digital" | "sunset-cyber" | "matrix-wave";

export interface ThemeSettings {
  preset: ThemePreset;
  backgroundType: "none" | "image" | "video";
  backgroundUrl: string;
  overlayOpacity: number;
}

const STORAGE_DIR = path.join(process.cwd(), "storage", "system");
const SETTINGS_FILE = path.join(STORAGE_DIR, "theme-settings.json");
const THEME_MEDIA_DIR = path.join(STORAGE_DIR, "theme-media");
export const MAX_THEME_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const allowedVideoExtensions = new Set([".mp4", ".webm", ".mov"]);

export const defaultThemeSettings: ThemeSettings = {
  preset: "spidey-neon",
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
    return { ...defaultThemeSettings, ...raw };
  } catch {
    return defaultThemeSettings;
  }
}

export function writeThemeSettings(settings: Partial<ThemeSettings>) {
  ensureThemeStorage();
  const merged = { ...readThemeSettings(), ...settings };
  const temp = `${SETTINGS_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(merged, null, 2), "utf-8");
  fs.renameSync(temp, SETTINGS_FILE);
  return merged;
}

function getSafeMediaTarget(fileName: string) {
  const ext = path.extname(path.basename(fileName)).toLowerCase();
  if (!allowedImageExtensions.has(ext) && !allowedVideoExtensions.has(ext)) {
    throw new Error("Only JPG, PNG, GIF, WebP, MP4, WebM, or MOV media is allowed.");
  }
  ensureThemeStorage();
  return {
    ext,
    targetName: `background${ext}`,
    targetPath: path.join(THEME_MEDIA_DIR, `background${ext}`),
    url: `/api/public/theme-media/background${ext}`,
  };
}

function removeOldThemeMedia(exceptName: string) {
  for (const existing of fs.readdirSync(THEME_MEDIA_DIR)) {
    if (!existing.startsWith("background.") || existing === exceptName) continue;
    try {
      fs.unlinkSync(path.join(THEME_MEDIA_DIR, existing));
    } catch {}
  }
}

export async function saveThemeMediaStream(fileName: string, source: AsyncIterable<Buffer | string>) {
  const target = getSafeMediaTarget(fileName);
  const tempPath = path.join(THEME_MEDIA_DIR, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const output = fs.createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
  let totalBytes = 0;

  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_THEME_MEDIA_BYTES) {
        throw new Error("Media file exceeds the 2 GiB maximum size.");
      }
      if (!output.write(buffer)) await once(output, "drain");
    }
    output.end();
    await once(output, "close");
    fs.renameSync(tempPath, target.targetPath);
    removeOldThemeMedia(target.targetName);
    return { backgroundUrl: target.url, bytes: totalBytes, extension: target.ext };
  } catch (error) {
    output.destroy();
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

/** Compatibility helper for small internal callers. Large uploads must use the stream API. */
export function saveThemeMedia(fileName: string, buffer: Buffer) {
  if (buffer.byteLength > MAX_THEME_MEDIA_BYTES) {
    throw new Error("Media file exceeds the 2 GiB maximum size.");
  }
  const target = getSafeMediaTarget(fileName);
  const tempPath = `${target.targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, buffer, { flag: "wx", mode: 0o600 });
  fs.renameSync(tempPath, target.targetPath);
  removeOldThemeMedia(target.targetName);
  return target.url;
}

export function getThemeMediaPath(fileName: string) {
  ensureThemeStorage();
  const safeName = path.basename(fileName);
  const targetPath = path.resolve(THEME_MEDIA_DIR, safeName);
  if (targetPath !== THEME_MEDIA_DIR && !targetPath.startsWith(`${THEME_MEDIA_DIR}${path.sep}`)) {
    throw new Error("SECURITY_ALERT: invalid theme media path");
  }
  return targetPath;
}
