import fs from "fs";
import path from "path";
import { spawn, execFile, execSync } from "child_process";
import { createHash } from "crypto";
import AdmZip from "adm-zip";
import { db } from "@/db";
import { servers, backups, templates, serverJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureDatabaseConnection } from "@/db";
import type { ChildProcess } from "child_process";
import { cryptoRandomString } from "@/lib/utils";

const BASE_STORAGE_DIR = path.resolve(process.cwd(), "storage");
const SERVERS_DIR = path.join(BASE_STORAGE_DIR, "servers");
const BACKUPS_DIR = path.join(BASE_STORAGE_DIR, "backups");

// Keep heavy telemetry off the Next.js request thread. Scanning a bot's
// node_modules directory every few seconds can freeze the whole panel.
const diskUsageCache = new Map<string, { bytes: number; refreshedAt: number; pending: boolean }>();
const processMetricsCache = new Map<string, { pid: number; cpuPercent: number; memoryBytes: number; refreshedAt: number; pending: boolean }>();
const activeProcesses = new Map<string, ChildProcess>();
const cancelRequested = new Set<string>();
const jobWatchers = new Map<string, ReturnType<typeof setInterval>>();
const networkUsageCache = {
  rxBytes: 0,
  txBytes: 0,
  sampledAt: 0,
  pending: false,
};
// Resource telemetry is intentionally sampled, not calculated on every UI poll.
// This keeps the control plane responsive while preserving useful live metrics.
const DISK_USAGE_TTL_MS = 10_000;
const PROCESS_METRICS_TTL_MS = 1_200;
const NETWORK_USAGE_TTL_MS = 2_000;
const STOP_GRACE_PERIOD_MS = Math.max(2_000, Number(process.env.SERVER_STOP_GRACE_MS || 8_000));
const MAX_CONSOLE_LOG_BYTES = Math.max(1_048_576, Number(process.env.MAX_CONSOLE_LOG_BYTES || 8 * 1024 * 1024));

function refreshDiskUsage(serverId: string, serverRoot: string) {
  const current = diskUsageCache.get(serverId) || { bytes: 0, refreshedAt: 0, pending: false };
  if (current.pending || Date.now() - current.refreshedAt < DISK_USAGE_TTL_MS) return;

  diskUsageCache.set(serverId, { ...current, pending: true });
  // Use background fast du with lower priority or lightweight du
  execFile(
    "du",
    ["-s", "--exclude=.birdserver-runtime", serverRoot],
    { timeout: 5_000 },
    (_error, stdout) => {
      const latest = diskUsageCache.get(serverId) || { bytes: 0, refreshedAt: 0, pending: false };
      const parsedKb = Number(String(stdout).trim().split(/\s+/)[0]);
      const parsedBytes = Number.isFinite(parsedKb) && parsedKb >= 0 ? parsedKb * 1024 : latest.bytes;
      diskUsageCache.set(serverId, {
        bytes: parsedBytes,
        refreshedAt: Date.now(),
        pending: false,
      });
    }
  );
}

function refreshProcessMetrics(serverId: string, pid: number) {
  const current = processMetricsCache.get(serverId) || { pid, cpuPercent: 0, memoryBytes: 0, refreshedAt: 0, pending: false };
  if (current.pid === pid && (current.pending || Date.now() - current.refreshedAt < PROCESS_METRICS_TTL_MS)) return current;

  processMetricsCache.set(serverId, { ...current, pid, pending: true });

  execFile("ps", ["-eo", "pid=,ppid=,rss=,%cpu="], { timeout: 1_000 }, (error, stdout) => {
    if (error) {
      processMetricsCache.set(serverId, {
        ...current,
        pid,
        refreshedAt: Date.now(),
        pending: false,
      });
      return;
    }

    const rows = String(stdout)
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 4)
      .map((parts) => ({
        pid: Number(parts[0]),
        ppid: Number(parts[1]),
        rssKb: Number(parts[2]),
        cpu: Number(parts[3]),
      }))
      .filter((row) => Number.isInteger(row.pid) && Number.isInteger(row.ppid));

    const targetPids = new Set<number>([pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (targetPids.has(row.ppid) && !targetPids.has(row.pid)) {
          targetPids.add(row.pid);
          changed = true;
        }
      }
    }

    let memoryBytes = 0;
    let cpuPercent = 0;
    for (const row of rows) {
      if (!targetPids.has(row.pid)) continue;
      if (Number.isFinite(row.rssKb) && row.rssKb >= 0) memoryBytes += row.rssKb * 1024;
      if (Number.isFinite(row.cpu) && row.cpu >= 0) cpuPercent += row.cpu;
    }

    processMetricsCache.set(serverId, {
      pid,
      memoryBytes: Number.isFinite(memoryBytes) ? memoryBytes : current.memoryBytes,
      cpuPercent: Number.isFinite(cpuPercent) ? Math.max(0, Math.round(cpuPercent * 10) / 10) : current.cpuPercent,
      refreshedAt: Date.now(),
      pending: false,
    });
  });

  return current;
}

function refreshNetworkUsage() {
  if (networkUsageCache.pending || Date.now() - networkUsageCache.sampledAt < NETWORK_USAGE_TTL_MS) {
    return networkUsageCache;
  }

  networkUsageCache.pending = true;
  try {
    const raw = fs.readFileSync("/proc/net/dev", "utf8");
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of raw.split(/\r?\n/).slice(2)) {
      const [, values] = line.split(":");
      if (!values) continue;
      const fields = values.trim().split(/\s+/).map(Number);
      if (fields.length >= 9) {
        if (Number.isFinite(fields[0])) rxBytes += fields[0];
        if (Number.isFinite(fields[8])) txBytes += fields[8];
      }
    }
    networkUsageCache.rxBytes = Math.max(0, rxBytes);
    networkUsageCache.txBytes = Math.max(0, txBytes);
    networkUsageCache.sampledAt = Date.now();
  } catch {
    // `/proc` is unavailable on some non-Linux development hosts. Null values
    // are more honest than fabricated network usage in that environment.
    networkUsageCache.rxBytes = 0;
    networkUsageCache.txBytes = 0;
    networkUsageCache.sampledAt = Date.now();
  } finally {
    networkUsageCache.pending = false;
  }
  return networkUsageCache;
}

function isWithinPath(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

fs.mkdirSync(SERVERS_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  updatedAt: string;
  extension: string;
}

interface RuntimeState {
  startedAt?: string;
  lastExitAt?: string;
  lastCommand?: string;
  pid?: number | null;
  jobId?: string;
  phase?: "creating" | "installing" | "starting" | "running" | "stopped" | "error";
}

export const DEFAULT_NODE_STARTUP_COMMAND = 'npm start';

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildRuntimePath(existingPath?: string) {
  const entries = [
    existingPath,
    process.env.PATH,
    path.dirname(process.execPath),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/app/.nix-profile/bin",
    "/layers/heroku_nodejs-engine/bin",
  ]
    .flatMap((item) => (item ? item.split(":") : []))
    .filter(Boolean);

  return Array.from(new Set(entries)).join(":");
}

function detectHostBinary(command: string, fallback: string) {
  try {
    const resolved = execSync(`command -v ${command}`, {
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: buildRuntimePath(process.env.PATH),
      },
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)[0];

    return resolved || fallback;
  } catch {
    return fallback;
  }
}

const hostBinaries = {
  node: detectHostBinary("node", process.execPath || "/usr/local/bin/node"),
  npm: detectHostBinary("npm", "npm"),
  npx: detectHostBinary("npx", "npx"),
  pnpm: detectHostBinary("pnpm", "pnpm"),
  yarn: detectHostBinary("yarn", "yarn"),
  timeout: detectHostBinary("timeout", "timeout"),
  bash: detectHostBinary("bash", "/bin/bash"),
};

interface RuntimeBinaries {
  node: string;
  npm: string;
  npx: string;
  binDir: string;
  version: string;
}

function inferNodeVersionFromImage(image?: string | null) {
  const match = String(image || "").match(/(?:^|\/)node[:\-]?(\d+)(?:[.\d]*)?/i);
  return match?.[1] || "";
}

function normalizeNodeVersion(value?: string | null, image?: string | null, category?: string) {
  const explicit = String(value || "").trim().toLowerCase().replace(/^v/, "");
  if (explicit && explicit !== "system" && /^\d+(?:\.\d+){0,2}$/.test(explicit)) return explicit;
  const imageVersion = inferNodeVersionFromImage(image);
  if (imageVersion) return imageVersion;
  if (/telegram|whatsapp/i.test(category || "")) return "22";
  if (/node/i.test(category || "")) return "system";
  return "system";
}

function getNodeArch() {
  const arch = execSync("uname -m", { encoding: "utf-8" }).trim();
  if (arch === "x86_64" || arch === "amd64") return "x64";
  if (arch === "aarch64" || arch === "arm64") return "arm64";
  throw new Error(`Unsupported Linux architecture: ${arch}`);
}

function getNodeRuntimeDir(serverId: string, version: string) {
  return getSecurePath(serverId, `.birdserver-runtime/node-v${version}`);
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

async function ensureNodeRuntime(serverId: string, version: string): Promise<RuntimeBinaries> {
  if (version === "system") {
    return {
      node: hostBinaries.node,
      npm: hostBinaries.npm,
      npx: hostBinaries.npx,
      binDir: path.dirname(hostBinaries.node),
      version: execSync(`${shellQuote(hostBinaries.node)} -p process.versions.node`, { encoding: "utf-8" }).trim(),
    };
  }

  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 18 || major > 26) {
    throw new Error(`Unsupported Node.js runtime version: ${version}. Use system or a Node.js major from 18 to 26.`);
  }

  const runtimeVersion = version.includes(".") ? version : ({
    18: "18.20.8",
    20: "20.20.2",
    22: "22.23.2",
    23: "23.11.1",
    24: "24.18.1",
    25: "25.9.0",
    26: "26.1.0",
  } as Record<number, string>)[major] || version;

  const arch = getNodeArch();
  const runtimeDir = getNodeRuntimeDir(serverId, runtimeVersion);
  const nodeBin = path.join(runtimeDir, "bin", "node");
  const npmBin = path.join(runtimeDir, "bin", "npm");
  const npxBin = path.join(runtimeDir, "bin", "npx");

  const validateRuntime = () => {
    if (!fs.existsSync(nodeBin) || !fs.existsSync(npmBin)) return false;
    try {
      const actual = execSync(`${shellQuote(nodeBin)} -p process.versions.node`, {
        encoding: "utf-8",
        env: { ...process.env, PATH: buildRuntimePath(path.dirname(nodeBin)) },
      }).trim();
      return actual === runtimeVersion;
    } catch {
      return false;
    }
  };

  if (!validateRuntime()) {
    const tmpRoot = path.join(getRuntimeDirectory(serverId), `node-download-${runtimeVersion}-${arch}`);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });

    // IMPORTANT: always use the official Node.js hostname.
    const baseUrls = [
      `https://nodejs.org/dist/v${runtimeVersion}`,
      `https://nodejs.org/download/release/v${runtimeVersion}`,
    ];
    const archiveXz = `node-v${runtimeVersion}-linux-${arch}.tar.xz`;
    const archiveGz = `node-v${runtimeVersion}-linux-${arch}.tar.gz`;

    const download = async (url: string, output: string) => {
      const env = { ...process.env, PATH: buildRuntimePath(process.env.PATH) };
      const curl = detectHostBinary("curl", "");
      const wget = detectHostBinary("wget", "");

      if (curl) {
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            curl,
            ["--fail", "--location", "--retry", "3", "--retry-delay", "2", "--connect-timeout", "20", "--max-time", "600", url, "--output", output],
            { cwd: tmpRoot, env, timeout: 660_000 },
            (error) => error ? reject(error) : resolve()
          );
          child.stdout?.resume();
          child.stderr?.resume();
        });
        return;
      }

      if (wget) {
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            wget,
            ["--https-only", "--tries=3", "--timeout=20", `--output-document=${output}`, url],
            { cwd: tmpRoot, env, timeout: 660_000 },
            (error) => error ? reject(error) : resolve()
          );
          child.stdout?.resume();
          child.stderr?.resume();
        });
        return;
      }

      throw new Error("Neither curl nor wget is available to download the selected Node.js runtime.");
    };

    let downloadedArchive = "";
    let lastDownloadError = "";
    for (const baseUrl of baseUrls) {
      for (const archive of [archiveXz, archiveGz]) {
        try {
          const archivePath = path.join(tmpRoot, archive);
          await download(`${baseUrl}/${archive}`, archivePath);
          downloadedArchive = archivePath;
          break;
        } catch (error) {
          lastDownloadError = error instanceof Error ? error.message : String(error);
          fs.rmSync(path.join(tmpRoot, archive), { force: true });
        }
      }
      if (downloadedArchive) break;
    }

    if (!downloadedArchive) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      throw new Error(
        `Unable to download Node.js ${runtimeVersion} from the official Node.js servers. ` +
        `Check Railway outbound DNS/HTTPS access. Last error: ${lastDownloadError}`
      );
    }

    const sumsPath = path.join(tmpRoot, "SHASUMS256.txt");
    let sumsDownloaded = false;
    for (const baseUrl of baseUrls) {
      try {
        await download(`${baseUrl}/SHASUMS256.txt`, sumsPath);
        sumsDownloaded = true;
        break;
      } catch {
        fs.rmSync(sumsPath, { force: true });
      }
    }
    if (!sumsDownloaded) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      throw new Error(`Downloaded Node.js ${runtimeVersion}, but could not download its official SHASUMS256.txt.`);
    }

    const archiveName = path.basename(downloadedArchive);
    const expectedLine = fs.readFileSync(sumsPath, "utf-8")
      .split(/\r?\n/)
      .find((line) => line.trim().endsWith(`  ${archiveName}`) || line.trim().endsWith(` *${archiveName}`));

    if (!expectedLine) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      throw new Error(`Official checksum entry for ${archiveName} was not found.`);
    }

    const expected = expectedLine.trim().split(/\s+/)[0];
    const actual = await sha256File(downloadedArchive);
    if (actual !== expected) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      throw new Error(`Node.js runtime checksum mismatch for ${archiveName}.`);
    }

    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });

    const tarArgs = downloadedArchive.endsWith(".tar.xz")
      ? ["-xJf", downloadedArchive, "-C", tmpRoot]
      : ["-xzf", downloadedArchive, "-C", tmpRoot];
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        "tar",
        tarArgs,
        { cwd: tmpRoot, timeout: 300_000 },
        (error) => error ? reject(error) : resolve()
      );
      child.stdout?.resume();
      child.stderr?.resume();
    });

    const extracted = path.join(tmpRoot, `node-v${runtimeVersion}-linux-${arch}`);
    if (!fs.existsSync(extracted)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      throw new Error(`Node.js archive extracted successfully, but expected directory was missing.`);
    }

    fs.renameSync(extracted, runtimeDir);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  if (!validateRuntime()) {
    throw new Error(`Node.js ${runtimeVersion} runtime is present but failed its version validation.`);
  }

  const actualVersion = execSync(`${shellQuote(nodeBin)} -p process.versions.node`, {
    encoding: "utf-8",
    env: { ...process.env, PATH: buildRuntimePath(path.dirname(nodeBin)) },
  }).trim();

  return { node: nodeBin, npm: npmBin, npx: npxBin, binDir: path.dirname(nodeBin), version: actualVersion };
}

function detectMainFile(serverRoot: string) {
  const candidates = ["index.js", "app.js", "server.js", "main.js", "dist/index.js", "src/index.js"];

  const packageJsonPath = path.join(serverRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { main?: string };
      if (pkg.main && fs.existsSync(path.join(serverRoot, pkg.main))) {
        return pkg.main;
      }
    } catch {}
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(serverRoot, candidate))) {
      return candidate;
    }
  }

  return "index.js";
}

export function getDefaultServerEnv(templateCategory: string, projectRootPath?: string) {
  const defaultMainFile = projectRootPath ? detectMainFile(projectRootPath) : "index.js";
  const baseEnv: Record<string, string> = {
    AUTO_UPDATE: "0",
    NODE_PACKAGES: "",
    UNNODE_PACKAGES: "",
    MAIN_FILE: defaultMainFile,
    NODE_RUNTIME_VERSION: "system",
    PYTHON_PACKAGES: "",
    OS_PACKAGES: "",
    npm_config_include: "dev",
  };

  if (/telegram bot/i.test(templateCategory)) {
    return {
      ...baseEnv,
      NODE_RUNTIME_VERSION: "22",
      BOT_TOKEN: "",
    };
  }

  if (/whatsapp bot/i.test(templateCategory)) {
    return {
      ...baseEnv,
      NODE_RUNTIME_VERSION: "22",
      SESSION_NAME: "birdserver-wa-session",
    };
  }

  return baseEnv;
}

function normalizeStartupCommand(rawCommand: string, projectRootPath: string, runtime: RuntimeBinaries) {
  return rawCommand
    .replaceAll("/home/container", projectRootPath)
    .replaceAll("/usr/local/bin/node", runtime.node)
    .replaceAll("/usr/bin/node", runtime.node)
    .replaceAll("/usr/local/bin/npm", runtime.npm)
    .replaceAll("/usr/bin/npm", runtime.npm)
    .replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, "${$1}");
}

function resolveRuntimeWorkingDirectory(serverRoot: string, configuredWorkingDirectory?: string | null) {
  const raw = (configuredWorkingDirectory || "/home/container").trim();
  const normalized = raw.replaceAll("/home/container", serverRoot);
  const absolute = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(serverRoot, normalized);

  if (!isWithinPath(serverRoot, absolute)) {
    return serverRoot;
  }

  fs.mkdirSync(absolute, { recursive: true });
  return absolute;
}

export function getSecurePath(serverId: string, userRelPath: string = ""): string {
  const serverRoot = path.resolve(SERVERS_DIR, serverId);
  if (!fs.existsSync(serverRoot)) {
    fs.mkdirSync(serverRoot, { recursive: true });
  }

  const targetPath = path.resolve(serverRoot, userRelPath.replace(/^\/+/, ""));
  if (!isWithinPath(serverRoot, targetPath)) {
    throw new Error("SECURITY_ALERT: Path traversal detected");
  }

  return targetPath;
}

export function getServerDirectory(serverId: string): string {
  return getSecurePath(serverId, "");
}

export function toContainerPath(relPath: string = "") {
  const normalized = relPath.replace(/^\/+|\/+$/g, "");
  return normalized ? `/home/container/${normalized}` : "/home/container";
}

export function inspectProjectDirectory(serverId: string, relPath: string = "") {
  const absolutePath = getSecurePath(serverId, relPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error("Folder not found");
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error("Selected path is not a folder");
  }

  const mainFile = detectMainFile(absolutePath);
  const hasPackageJson = fs.existsSync(path.join(absolutePath, "package.json"));
  return {
    absolutePath,
    containerPath: toContainerPath(relPath),
    mainFile,
    hasPackageJson,
  };
}

function getRuntimeDirectory(serverId: string) {
  const runtimeDir = getSecurePath(serverId, ".birdserver-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  return runtimeDir;
}

function prepareRuntimeContainerAlias(serverId: string, targetDirectory: string) {
  const runtimeDir = getRuntimeDirectory(serverId);
  const aliasPath = path.join(runtimeDir, "container-root");

  try {
    if (fs.existsSync(aliasPath) || fs.lstatSync(aliasPath)) {
      fs.rmSync(aliasPath, { recursive: true, force: true });
    }
  } catch {}

  try {
    fs.symlinkSync(targetDirectory, aliasPath, "dir");
    return aliasPath;
  } catch {
    return targetDirectory;
  }
}

export function getServerConsolePaths(serverId: string) {
  const runtimeDir = getRuntimeDirectory(serverId);
  return {
    runtimeDir,
    inputLogPath: path.join(runtimeDir, "console-input.log"),
    outputLogPath: path.join(runtimeDir, "console-output.log"),
    inputPipePath: path.join(runtimeDir, "console-input.pipe"),
    stateFilePath: path.join(runtimeDir, "state.json"),
  };
}

function writeRuntimeState(serverId: string, partialState: RuntimeState) {
  const { stateFilePath } = getServerConsolePaths(serverId);
  const currentState = readRuntimeState(serverId);
  fs.writeFileSync(
    stateFilePath,
    JSON.stringify({ ...currentState, ...partialState }, null, 2),
    "utf-8"
  );
}

function readRuntimeState(serverId: string): RuntimeState {
  const { stateFilePath } = getServerConsolePaths(serverId);
  if (!fs.existsSync(stateFilePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(stateFilePath, "utf-8")) as RuntimeState;
  } catch {
    return {};
  }
}

function appendConsoleOutput(serverId: string, line: string) {
  const { outputLogPath } = getServerConsolePaths(serverId);
  fs.mkdirSync(path.dirname(outputLogPath), { recursive: true });
  try {
    if (fs.existsSync(outputLogPath) && fs.statSync(outputLogPath).size > MAX_CONSOLE_LOG_BYTES) {
      const tail = fs.readFileSync(outputLogPath).subarray(-Math.floor(MAX_CONSOLE_LOG_BYTES * 0.75));
      fs.writeFileSync(outputLogPath, Buffer.concat([Buffer.from(`[Birdserver] Console log rotated at ${new Date().toISOString()}\\n`), tail]));
    }
  } catch {}
  fs.appendFileSync(outputLogPath, `${line}\n`, "utf-8");
}

function isPidAlive(pid: number | null | undefined) {
  if (!pid || pid <= 0) return false;

  // Check the process table first so a zombie wrapper is not mistaken for a
  // live runtime. This prevents stale RUNNING state after npm or the bot exits.
  try {
    const output = execSync(`ps -p ${Math.trunc(pid)} -o pid=,stat=`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parts = output.split(/\s+/);
    return parts[0] === String(Math.trunc(pid)) && Boolean(parts[1]) && !parts[1].startsWith("Z");
  } catch {}

  // Some hosted Linux environments can reject ps visibility while the PID is
  // still signalable. Keep process.kill as a conservative fallback.
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureNodeConsoleSupport(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const current = fs.readFileSync(filePath, "utf-8");
  if (current.includes("process.stdin.on(")) return;

  const enhanced = `${current}\n\nprocess.stdin.resume();\nprocess.stdin.setEncoding(\"utf8\");\nprocess.stdin.on(\"data\", (chunk) => {\n  const command = String(chunk).trim();\n  if (!command) return;\n  console.log(\`[console] received command: ${"${command}"}\`);\n  if (command === \"status\") {\n    console.log(\`[status] uptime=${"${Math.floor(process.uptime())}"}s pid=${"${process.pid}"}\`);\n  } else if (command === \"help\") {\n    console.log(\"Available commands: status, help, ping, echo <text>\");\n  } else if (command === \"ping\") {\n    console.log(\"pong\");\n  } else if (command.startsWith(\"echo \")) {\n    console.log(command.slice(5));\n  }\n});\n`;

  fs.writeFileSync(filePath, enhanced, "utf-8");
}

export function initializeServerFiles(serverId: string, templateCategory: string) {
  const serverRoot = getServerDirectory(serverId);
  fs.mkdirSync(serverRoot, { recursive: true });

  if (/telegram bot/i.test(templateCategory)) {
    const packageJsonPath = path.join(serverRoot, "package.json");
    const indexPath = path.join(serverRoot, "index.js");

    if (!fs.existsSync(packageJsonPath)) {
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify(
          {
            name: `telegram-bot-${serverId}`,
            version: "1.0.0",
            main: "index.js",
            scripts: { start: "node index.js" },
            dependencies: {
              grammy: "^1.38.2",
            },
          },
          null,
          2
        )
      );
    }

    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        `const { Bot } = require("grammy");\n\nconst token = process.env.BOT_TOKEN;\n\nif (!token) {\n  console.log("[telegram] BOT_TOKEN is not set. Add it in Startup > Environment Variables.");\n  console.log("[telegram] Then run: npm install && npm start");\n  setInterval(() => console.log("[telegram] waiting for BOT_TOKEN..."), 15000);\n} else {\n  const bot = new Bot(token);\n  bot.command("start", (ctx) => ctx.reply("Birdserver Telegram bot is online ✅"));\n  bot.command("ping", (ctx) => ctx.reply("pong"));\n  bot.start();\n  console.log("[telegram] Bot started successfully");\n}\n\nprocess.stdin.resume();\nprocess.stdin.setEncoding("utf8");\nprocess.stdin.on("data", (chunk) => {\n  const command = String(chunk).trim();\n  if (!command) return;\n  console.log("[console] " + command);\n  if (command === "status") console.log("[telegram] process alive");\n});\n`
      );
    }

    ensureNodeConsoleSupport(indexPath);
    return;
  }

  if (/whatsapp bot/i.test(templateCategory)) {
    const packageJsonPath = path.join(serverRoot, "package.json");
    const indexPath = path.join(serverRoot, "index.js");

    if (!fs.existsSync(packageJsonPath)) {
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify(
          {
            name: `whatsapp-bot-${serverId}`,
            version: "1.0.0",
            main: "index.js",
            scripts: { start: "node index.js" },
            dependencies: {
              "@whiskeysockets/baileys": "^6.7.18",
              "pino": "^9.7.0",
              "qrcode-terminal": "^0.12.0",
            },
          },
          null,
          2
        )
      );
    }

    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        `const pino = require("pino");\n\n(async () => {\n  try {\n    const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");\n    const { state, saveCreds } = await useMultiFileAuthState(".wa-auth");\n\n    const sock = makeWASocket({\n      auth: state,\n      logger: pino({ level: "silent" }),\n      printQRInTerminal: false,\n    });\n\n    sock.ev.on("creds.update", saveCreds);\n    sock.ev.on("connection.update", ({ connection, qr }) => {\n      if (qr) {\n        console.log("[whatsapp] QR login received. Scan the clean QR card rendered by Birdserver panel.");\n        console.log("BIRDSERVER_QR:" + qr);\n      }\n      if (connection === "open") {\n        console.log("[whatsapp] Bot connected successfully ✅");\n      }\n      if (connection === "close") {\n        console.log("[whatsapp] Connection closed. Restart server if needed.");\n      }\n    });\n  } catch (error) {\n    console.log("[whatsapp] Dependencies not installed yet or startup failed:", error.message);\n    console.log("[whatsapp] Run: npm install && npm start");\n  }\n})();\n\nprocess.stdin.resume();\nprocess.stdin.setEncoding("utf8");\nprocess.stdin.on("data", (chunk) => {\n  const command = String(chunk).trim();\n  if (!command) return;\n  console.log("[console] " + command);\n  if (command === "status") console.log("[whatsapp] process alive");\n});\n`
      );
    }

    ensureNodeConsoleSupport(indexPath);
    return;
  }

  if (/python/i.test(templateCategory)) {
    const mainPy = path.join(serverRoot, "main.py");
    if (!fs.existsSync(mainPy)) {
      fs.writeFileSync(
        mainPy,
        `import datetime\nimport threading\nimport time\nimport sys\n\ndef read_stdin():\n    for line in sys.stdin:\n        cmd = line.strip()\n        if not cmd:\n            continue\n        print(f"[console] {cmd}")\n        if cmd == "status":\n            print("[python] process alive")\n\nthreading.Thread(target=read_stdin, daemon=True).start()\n\nprint("==========================================")\nprint("  BIRDSERVER V1 - Developer by BimzOfficial")\nprint("==========================================")\nprint("Python server is running...")\n\nwhile True:\n    print(f"[{datetime.datetime.now().isoformat()}] Python app active")\n    time.sleep(10)\n`
      );
    }
    return;
  }

  const packageJsonPath = path.join(serverRoot, "package.json");
  const indexPath = path.join(serverRoot, "index.js");

  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: `server-${serverId}`,
          version: "1.0.0",
          main: "index.js",
          scripts: { start: "node index.js" },
        },
        null,
        2
      )
    );
  }

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `console.log("==========================================");\nconsole.log("  BIRDSERVER V1 - Developer by BimzOfficial");\nconsole.log("==========================================");\nconsole.log("Server ${serverId} initialized successfully!");\nconsole.log("Timestamp:", new Date().toISOString());\n\nsetInterval(() => {\n  console.log("[" + new Date().toISOString() + "] Heartbeat tick - Server active");\n}, 10000);\n`
    );
  }

  ensureNodeConsoleSupport(indexPath);
}

function detectPackageManager(projectRoot: string) {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) {
    return { name: "pnpm", binary: hostBinaries.pnpm, install: "install --frozen-lockfile --reporter=append-only" };
  }
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) {
    return { name: "yarn", binary: hostBinaries.yarn, install: "install --non-interactive --ignore-engines" };
  }
  if (fs.existsSync(path.join(projectRoot, "package-lock.json")) || fs.existsSync(path.join(projectRoot, "npm-shrinkwrap.json"))) {
    return { name: "npm-ci", binary: hostBinaries.npm, install: "ci --no-audit --no-fund --progress=false --fetch-retries=3 --fetch-timeout=300000" };
  }
  return { name: "npm", binary: hostBinaries.npm, install: "install --no-audit --no-fund --progress=false --fetch-retries=3 --fetch-timeout=300000" };
}

function getDependencyKey(projectRoot: string, runtimeVersion: string, extra = "") {
  const hash = createHash("sha256");
  for (const name of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]) {
    const filePath = path.join(projectRoot, name);
    if (fs.existsSync(filePath)) {
      hash.update(name);
      hash.update(fs.readFileSync(filePath));
    }
  }
  hash.update(`node:${runtimeVersion}`);
  hash.update(`extra:${extra}`);
  return hash.digest("hex").slice(0, 24);
}

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type JobUpdate = Partial<{
  status: JobStatus;
  phase: string;
  progress: number;
  pid: number | null;
  lastOutput: string;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date;
  cancelledAt: Date;
  updatedAt: Date;
}>;

function newJobId() {
  return `job_${cryptoRandomString(16)}`;
}

async function createServerJob(serverId: string, ownerId: string | null | undefined, kind: string, command: string) {
  const id = newJobId();
  try {
    await ensureDatabaseConnection();
    await db.insert(serverJobs).values({
      id,
      serverId,
      ownerId: ownerId || null,
      kind,
      status: "running",
      phase: "creating",
      progress: 1,
      command: command.slice(0, 2_000),
      createdAt: new Date(),
      startedAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (error) {
    console.warn(`[Birdserver] job ${id} persistence unavailable:`, error instanceof Error ? error.message : error);
  }
  return id;
}

async function updateServerJob(jobId: string | undefined, update: JobUpdate) {
  if (!jobId) return;
  try {
    await db.update(serverJobs).set({ ...update, updatedAt: new Date() }).where(eq(serverJobs.id, jobId));
  } catch (error) {
    console.warn(`[Birdserver] job ${jobId} update skipped:`, error instanceof Error ? error.message : error);
  }
}

function startJobWatcher(serverId: string, jobId: string, outputLogPath: string, runtimeReadyMarker: string) {
  const existing = jobWatchers.get(serverId);
  if (existing) clearInterval(existing);
  let lastSignature = "";

  const watcher = setInterval(() => {
    try {
      const output = fs.existsSync(outputLogPath) ? fs.readFileSync(outputLogPath, "utf8").slice(-8_000) : "";
      let phase = "installing";
      let progress = 15;
      if (/resolv|download|fetch/i.test(output)) {
        phase = "resolving dependencies";
        progress = 30;
      }
      if (/linking|building native|npm (?:install|ci)/i.test(output)) {
        phase = "building dependencies";
        progress = 55;
      }
      if (/dependencies installation phase completed|dependencies verified from cache/i.test(output)) {
        phase = "finalizing dependencies";
        progress = 85;
      }
      const ready = fs.existsSync(runtimeReadyMarker);
      if (ready) {
        phase = "running";
        progress = 100;
      }
      const signature = `${phase}:${progress}:${ready ? "ready" : Math.floor(output.length / 1_000)}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      void updateServerJob(jobId, {
        status: ready ? "succeeded" : "running",
        phase,
        progress,
        lastOutput: output.slice(-4_000),
        ...(ready ? { finishedAt: new Date() } : {}),
      });
      if (ready) stopJobWatcher(serverId);
    } catch {
      // A disappearing server directory is expected during deletion.
    }
  }, 1_000);
  jobWatchers.set(serverId, watcher);
}

function stopJobWatcher(serverId: string) {
  const watcher = jobWatchers.get(serverId);
  if (watcher) clearInterval(watcher);
  jobWatchers.delete(serverId);
}

const startLocks = new Map<string, Promise<boolean>>();

export async function startServer(serverId: string): Promise<boolean> {
  const existingStart = startLocks.get(serverId);
  if (existingStart) return existingStart;

  const operation = startServerInternal(serverId);
  startLocks.set(serverId, operation);
  try {
    return await operation;
  } catch (error) {
    const failedJobId = readRuntimeState(serverId).jobId;
    await updateServerJob(failedJobId, {
      status: "failed",
      phase: "start failed",
      progress: 0,
      pid: null,
      errorCode: "START_FAILED",
      finishedAt: new Date(),
      lastOutput: error instanceof Error ? error.message : String(error),
    });
    await db.update(servers).set({ status: "error", pid: 0, updatedAt: new Date() }).where(eq(servers.id, serverId)).catch(() => undefined);
    writeRuntimeState(serverId, { phase: "error", pid: null, lastExitAt: new Date().toISOString() });
    throw error;
  } finally {
    if (startLocks.get(serverId) === operation) startLocks.delete(serverId);
  }
}

async function startServerInternal(serverId: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");
  if (server.status === "suspended") throw new Error("Server is suspended");
  if (process.env.VERCEL === "1") {
    appendConsoleOutput(
      serverId,
      "[Birdserver] Real long-lived bot runtime is not supported on Vercel serverless. Deploy Birdserver on Railway or another persistent Node host for real bot execution."
    );
    throw new Error("Real bot runtime is not supported on Vercel. Use Railway or another persistent Node.js host.");
  }

  const persistedRuntimePid = readRuntimeState(serverId).pid ?? server.pid ?? null;
  if (isPidAlive(persistedRuntimePid)) {
    appendConsoleOutput(serverId, "[Birdserver] Server already running");
    return true;
  }

  let templateCategory = "Node.js";
  if (server.templateId) {
    const template = await db.query.templates.findFirst({ where: eq(templates.id, server.templateId) });
    if (template?.category) templateCategory = template.category;
  }

  const serverRoot = getServerDirectory(serverId);
  writeRuntimeState(serverId, { phase: "creating", pid: null });
  await db.update(servers).set({ status: "creating", pid: 0, updatedAt: new Date() }).where(eq(servers.id, serverId)).catch(() => undefined);
  initializeServerFiles(serverId, templateCategory);
  const runtimeWorkingDirectory = resolveRuntimeWorkingDirectory(serverRoot, server.workingDirectory);
  const runtimeContainerAlias = prepareRuntimeContainerAlias(serverId, runtimeWorkingDirectory);

  const initialEnv = {
    ...getDefaultServerEnv(templateCategory, runtimeWorkingDirectory),
    ...((server.envVars as Record<string, string>) || {}),
  };
  const selectedNodeVersion = normalizeNodeVersion(initialEnv.NODE_RUNTIME_VERSION, server.dockerImage, templateCategory);
  const runtime = await ensureNodeRuntime(serverId, selectedNodeVersion);
  await db.update(servers).set({ status: "installing", updatedAt: new Date() }).where(eq(servers.id, serverId)).catch(() => undefined);

  const runtimeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...initialEnv,
    SERVER_ID: server.id,
    BIRDSERVER: "V1",
    NODE_ENV: process.env.NODE_ENV || "production",
    PWD: runtimeWorkingDirectory,
    HOME: serverRoot,
    PATH: [runtime.binDir, buildRuntimePath(process.env.PATH)].filter(Boolean).join(":"),
    NODE_RUNTIME_VERSION: selectedNodeVersion,
    npm_config_progress: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_maxsockets: "8",
  };

  if (!runtimeEnv.MAIN_FILE) runtimeEnv.MAIN_FILE = detectMainFile(runtimeWorkingDirectory);
  if (!runtimeEnv.AUTO_UPDATE) runtimeEnv.AUTO_UPDATE = "0";
  if (!runtimeEnv.NODE_PACKAGES) runtimeEnv.NODE_PACKAGES = "";
  if (!runtimeEnv.UNNODE_PACKAGES) runtimeEnv.UNNODE_PACKAGES = "";
  if (!runtimeEnv.npm_config_include) runtimeEnv.npm_config_include = "dev";
  // Do not reserve a 4 GB V8 heap on a small Railway/container host. That
  // setting made npm look like it crashed the entire panel under memory
  // pressure. Keep an explicit operator value, otherwise use a conservative
  // default that can be overridden with NODE_OPTIONS.
  // OOM-Guard: Limit bot memory to 384MB max so Railway container never crashes with OOM
  const nodeOptions = runtimeEnv.NODE_OPTIONS?.trim() || "--max-old-space-size=384";

  const rawStartupCommand = (server.startupCommand || DEFAULT_NODE_STARTUP_COMMAND).trim();
  const normalizedStartupCommand = normalizeStartupCommand(rawStartupCommand, runtimeContainerAlias, runtime);
  const dependencyKey = getDependencyKey(
    runtimeWorkingDirectory,
    runtime.version,
    `${initialEnv.NODE_PACKAGES || ""}|${initialEnv.UNNODE_PACKAGES || ""}|${initialEnv.PYTHON_PACKAGES || ""}|${initialEnv.OS_PACKAGES || ""}`
  );
  const dependencyMarker = path.join(getRuntimeDirectory(serverId), `deps-${dependencyKey}.ok`);
  const runtimeReadyMarker = path.join(getRuntimeDirectory(serverId), "runtime-ready");
  const hasExplicitNodeInstall = /\b(?:npm|pnpm|yarn)\s+(?:install|ci)\b/.test(rawStartupCommand);
  const jobId = await createServerJob(serverId, server.userId, "runtime", rawStartupCommand);
  writeRuntimeState(serverId, { jobId, phase: "installing", pid: null });
  cancelRequested.delete(serverId);
  try { fs.rmSync(runtimeReadyMarker, { force: true }); } catch {}

  // Dependency installation is real, but it is cached by the package manifests.
  // The old version ran `npm install` on every START, which made every restart
  // painfully slow and kept large dependency trees active for no reason.
  const dependencyCheckScriptPath = path.join(getRuntimeDirectory(serverId), "check-dependencies.mjs");
  const dependencyCheckScript = `import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
if (!fs.existsSync(packagePath)) process.exit(0);

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const groups = [
  ["dependencies", pkg.dependencies || {}],
  ["optionalDependencies", pkg.optionalDependencies || {}],
];
const missing = [];

for (const [, deps] of groups) {
  for (const name of Object.keys(deps)) {
    const target = path.join(root, "node_modules", ...name.split("/"));
    if (!fs.existsSync(target)) missing.push(name);
  }
}

if (missing.length) {
  console.log("[Birdserver] Missing npm packages: " + missing.join(", "));
  process.exit(2);
}

process.exit(0);
`;
  fs.writeFileSync(dependencyCheckScriptPath, dependencyCheckScript, "utf8");

  const dependencyStatusPath = path.join(getRuntimeDirectory(serverId), "dependency-status.json");

  const packageManager = detectPackageManager(runtimeWorkingDirectory);
  const installTimeoutSeconds = Math.max(120, Math.min(7_200, Number(process.env.SERVER_INSTALL_TIMEOUT_SECONDS || 1_800)));
  const dependencyCommand = `${shellQuote(packageManager.binary)} ${packageManager.install}`;
  const dependencyBootstrap = [
    'set -Eeuo pipefail',
    `echo '[Birdserver] Node runtime: ${runtime.version} (selected=${selectedNodeVersion})'`,
    `if [[ -f package.json ]]; then`,
    `  export NODE_OPTIONS=${shellQuote(nodeOptions)}`,
    `  dependency_needs_install=0`,
    `  if [[ ! -d node_modules ]]; then dependency_needs_install=1; echo '[Birdserver] node_modules is missing; dependency repair required.'; fi`,
    `  if [[ "$dependency_needs_install" -eq 0 && -f ${shellQuote(dependencyMarker)} ]]; then`,
    `    if ! ${shellQuote(runtime.node)} ${shellQuote(dependencyCheckScriptPath)} > ${shellQuote(dependencyStatusPath)} 2>&1; then`,
    `      dependency_needs_install=1`,
    `      echo '[Birdserver] Cached dependency marker is stale; repairing dependencies...'`,
    `    fi`,
    `  else`,
    `    dependency_needs_install=1`,
    `  fi`,
    `  if [[ "$dependency_needs_install" -eq 1 ]]; then`,
    `    if [[ "${hasExplicitNodeInstall ? "1" : "0"}" -eq 1 ]]; then`,
    `      echo '[Birdserver] Startup command contains explicit install; preserving user command.'`,
    `    else`,
    `      echo '[Birdserver] Dependency manager: ${packageManager.name}'`,
    `      if ! command -v ${shellQuote(packageManager.binary)} >/dev/null 2>&1; then echo '[Birdserver] Selected package manager is unavailable on this host.'; exit 127; fi`,
    `      echo '[Birdserver] Installing dependencies with a ${installTimeoutSeconds}s stage timeout.'`,
    `      if ! ${shellQuote(hostBinaries.timeout)} --signal=TERM --kill-after=30s ${installTimeoutSeconds}s ${dependencyCommand}; then`,
    `        echo '[Birdserver] Primary dependency install failed; retrying once with offline cache only.'`,
    `        if [[ '${packageManager.name}' == 'npm-ci' || '${packageManager.name}' == 'npm' ]]; then`,
    `          if ! ${shellQuote(hostBinaries.timeout)} --signal=TERM --kill-after=30s 300s ${shellQuote(runtime.npm)} install --no-audit --no-fund --progress=false --prefer-offline --fetch-retries=1; then`,
    `            echo '[Birdserver] Dependency installation failed after one bounded retry.'`,
    `            exit 1`,
    `          fi`,
    `        else`,
    `          exit 1`,
    `        fi`,
    `      fi`,
    `    fi`,
    `    touch ${shellQuote(dependencyMarker)}`,
    `    echo '[Birdserver] Dependencies installation phase completed successfully.'`,
    `  else`,
    `    echo '[Birdserver] Dependencies verified from cache; skipping install.'`,
    `  fi`,
    `else`,
    `  echo '[Birdserver] No package.json found; skipping dependency installation.'`,
    `fi`,
    `if [[ -n "\${NODE_PACKAGES}" ]]; then ${shellQuote(runtime.npm)} install --no-audit --no-fund --progress=false --prefer-offline \${NODE_PACKAGES}; fi`,
    `if [[ -n "\${UNNODE_PACKAGES}" ]]; then ${shellQuote(runtime.npm)} uninstall \${UNNODE_PACKAGES}; fi`,
    `if [[ -f requirements.txt ]]; then if ! command -v python3 >/dev/null 2>&1; then echo '[Birdserver] requirements.txt exists but python3 is unavailable.'; exit 127; fi; python3 -m pip install --no-input -r requirements.txt || python3 -m pip install --no-input --user -r requirements.txt; fi`,
    `if [[ -n "\${PYTHON_PACKAGES}" ]]; then if ! command -v python3 >/dev/null 2>&1; then echo '[Birdserver] PYTHON_PACKAGES requested but python3 is unavailable.'; exit 127; fi; python3 -m pip install --no-input --user \${PYTHON_PACKAGES} || python3 -m pip install --no-input \${PYTHON_PACKAGES}; fi`,
    `if [[ -n "\${OS_PACKAGES}" ]]; then if ! command -v apt-get >/dev/null 2>&1 || [[ "$(id -u)" != "0" ]]; then echo '[Birdserver] OS_PACKAGES requested, but apt-get/root access is unavailable on this host.'; exit 126; fi; DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \${OS_PACKAGES}; fi`,
    `echo '[Birdserver] Runtime preparation complete. Starting configured command...'`,
  ].join('\n');

  // Preserve an explicit npm install/ci in the configured command. It may
  // install packages that are not listed in package.json; silently removing it
  // made the console appear successful while skipping the user's real request.
  const cleanedStartupCommand = normalizedStartupCommand.trim();
  const baseStartupCommand = cleanedStartupCommand || `${shellQuote(runtime.npm)} start`;
  const readinessMarkerCommand = `touch ${shellQuote(runtimeReadyMarker)}`;
  // The UI must remain STARTING while an explicit npm install is running. For
  // the common `npm install ... && npm start` form, place the marker between
  // both commands; otherwise mark the runtime ready immediately before the
  // configured start command.
  const finalStartupCommand = hasExplicitNodeInstall
    ? baseStartupCommand.replace(
        /(\b(?:npm|pnpm|yarn)\s+(?:install|ci)\b[^;&]*)(\s*(?:&&|;)\s*)/i,
        `$1 && ${readinessMarkerCommand} && `
      )
    : `${readinessMarkerCommand} && ${baseStartupCommand}`;

  const { inputLogPath, outputLogPath } = getServerConsolePaths(serverId);
  fs.writeFileSync(inputLogPath, "", "utf-8");
  fs.appendFileSync(
    outputLogPath,
    `\n[Birdserver] ===== START ${new Date().toISOString()} =====\n[Birdserver] Server Root: ${serverRoot}\n[Birdserver] Working Dir: ${runtimeWorkingDirectory}\n[Birdserver] Container Alias: ${runtimeContainerAlias}\n[Birdserver] Startup Command: ${server.startupCommand}\n[Birdserver] Resolved Startup: ${finalStartupCommand}\n[Birdserver] MAIN_FILE=${runtimeEnv.MAIN_FILE}\n[Birdserver] NODE_BIN=${hostBinaries.node}\n[Birdserver] NPM_BIN=${hostBinaries.npm}\n[Birdserver] NPX_BIN=${hostBinaries.npx}\n[Birdserver] PATH=${runtimeEnv.PATH}\n`,
    "utf-8"
  );

  // Keep the startup script separate from the supervisor. This avoids shell
  // quoting bugs and gives the panel one process-group PID to terminate.
  const runtimeDir = getRuntimeDirectory(serverId);
  const inputPipePath = path.join(runtimeDir, "console-input.pipe");
  const startupScriptPath = path.join(runtimeDir, "start-runtime.sh");
  const supervisorScriptPath = path.join(runtimeDir, "supervisor.sh");

  try {
    if (fs.existsSync(inputPipePath)) fs.rmSync(inputPipePath, { force: true });
  } catch {}

  const startupScript = [
    "#!/usr/bin/env bash",
    "set -Eeuo pipefail",
    "",
    dependencyBootstrap,
    "",
    `echo '[Birdserver] Executing startup command...'`,
    `echo ${shellQuote(finalStartupCommand)}`,
    finalStartupCommand,
  ].join("\n");

  fs.writeFileSync(startupScriptPath, startupScript + "\n", {
    encoding: "utf-8",
    mode: 0o700,
  });

  const supervisorScript = [
    "#!/usr/bin/env bash",
    "set -Eeuo pipefail",
    `rm -f ${shellQuote(inputPipePath)}`,
    `mkfifo -m 600 ${shellQuote(inputPipePath)}`,
    `cleanup() { kill \"$feeder\" 2>/dev/null || true; wait \"$feeder\" 2>/dev/null || true; rm -f ${shellQuote(inputPipePath)}; }`,
    "trap cleanup EXIT",
    `tail -n 0 -F ${shellQuote(inputLogPath)} > ${shellQuote(inputPipePath)} & feeder=$!`,
    "set +e",
    `${hostBinaries.bash} ${shellQuote(startupScriptPath)} < ${shellQuote(inputPipePath)} >> ${shellQuote(outputLogPath)} 2>&1`,
    "runtime_rc=$?",
    "set -e",
    "exit \"$runtime_rc\"",
  ].join("\n");

  fs.writeFileSync(supervisorScriptPath, supervisorScript + "\n", {
    encoding: "utf-8",
    mode: 0o700,
  });

  const child = spawn(hostBinaries.bash, [supervisorScriptPath], {
    cwd: runtimeWorkingDirectory,
    env: runtimeEnv,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });

  child.on("exit", (code, signal) => {
    const wasCancelled = cancelRequested.delete(serverId);
    const exitMessage = `[Birdserver] Runtime exited (code=${code ?? "null"}, signal=${signal ?? "none"}).`;
    appendConsoleOutput(serverId, exitMessage);
    stopJobWatcher(serverId);
    activeProcesses.delete(serverId);
    writeRuntimeState(serverId, { lastExitAt: new Date().toISOString(), pid: null, phase: wasCancelled ? "stopped" : (code === 0 ? "stopped" : "error") });
    void updateServerJob(jobId, {
      status: wasCancelled ? "cancelled" : (code === 0 ? "succeeded" : "failed"),
      phase: wasCancelled ? "cancelled" : (code === 0 ? "stopped" : "runtime failed"),
      progress: wasCancelled ? 0 : (code === 0 ? 100 : 0),
      pid: null,
      errorCode: code && code !== 0 ? `EXIT_${code}` : null,
      finishedAt: new Date(),
      lastOutput: exitMessage,
    });
    void db.update(servers)
      .set({ status: wasCancelled ? "stopped" : (code === 0 ? "stopped" : "error"), pid: 0, updatedAt: new Date() })
      .where(eq(servers.id, serverId))
      .catch((error) => console.warn(`[Birdserver] Exit status sync skipped for ${serverId}:`, error));
  });
  activeProcesses.set(serverId, child);
  child.unref();

  // Persist runtime state first. The process itself is the source of truth
  // for the live status page, so a hosted-Postgres write failure must never
  // turn a successfully started process into a failed START request.
  const runtimePid = child.pid ?? 0;
  writeRuntimeState(serverId, {
    startedAt: new Date().toISOString(),
    lastCommand: server.startupCommand,
    pid: runtimePid,
    jobId,
    phase: "installing",
    lastExitAt: undefined,
  });
  startJobWatcher(serverId, jobId, outputLogPath, runtimeReadyMarker);

  try {
    await db
      .update(servers)
      .set({ status: "starting", pid: runtimePid, updatedAt: new Date() })
      .where(eq(servers.id, serverId));
  } catch (dbError) {
    console.warn(`[Birdserver] Database status sync skipped for ${serverId}:`, dbError);
    appendConsoleOutput(serverId, `[Birdserver] Runtime status is active.`);
  }

  appendConsoleOutput(serverId, `[Birdserver] Detached runtime started with PID ${runtimePid}`);
  appendConsoleOutput(serverId, `[Birdserver] Dependency mode: real host runtime (npm/pip/OS packages where available).`);

  // A syntax error or missing executable can make the wrapper exit between
  // spawn() and the database UPDATE above. Re-check the real PID so START
  // never reports success for a process that has already died.
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!isPidAlive(runtimePid)) {
    writeRuntimeState(serverId, {
      lastExitAt: new Date().toISOString(),
      pid: null,
      phase: "stopped",
    });
    try {
      await db
        .update(servers)
        .set({ status: "stopped", pid: 0, updatedAt: new Date() })
        .where(eq(servers.id, serverId));
    } catch (dbError) {
      console.warn(`[Birdserver] Immediate exit status sync skipped for ${serverId}:`, dbError);
    }
    appendConsoleOutput(serverId, `[Birdserver] Runtime stopped immediately after START. Check the console output above.`);
    return false;
  }

  return true;
}

async function cancelServerJobs(serverId: string, reason: "stop" | "delete" | "kill") {
  try {
    const jobs = await db.query.serverJobs.findMany({ where: eq(serverJobs.serverId, serverId) });
    for (const job of jobs) {
      if (job.status !== "running" && job.status !== "queued") continue;
      await db.update(serverJobs).set({
        status: "cancelled",
        phase: `cancelled: ${reason}`,
        progress: 0,
        pid: null,
        cancelledAt: new Date(),
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(serverJobs.id, job.id));
    }
  } catch (error) {
    console.warn(`[Birdserver] job cancellation skipped for ${serverId}:`, error instanceof Error ? error.message : error);
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !isPidAlive(pid);
}

async function terminateServerProcess(serverId: string, reason: "stop" | "delete" | "kill", force = false) {
  const state = readRuntimeState(serverId);
  const runtimePid = state.pid ?? null;
  cancelRequested.add(serverId);
  stopJobWatcher(serverId);
  await cancelServerJobs(serverId, reason);

  if (runtimePid && isPidAlive(runtimePid)) {
    signalProcessGroup(runtimePid, force ? "SIGKILL" : "SIGTERM");
    if (!force && !(await waitForProcessExit(runtimePid, STOP_GRACE_PERIOD_MS))) {
      appendConsoleOutput(serverId, `[Birdserver] Grace period elapsed; forcing process group ${runtimePid} to exit.`);
      signalProcessGroup(runtimePid, "SIGKILL");
      await waitForProcessExit(runtimePid, 2_000);
    }
  }

  activeProcesses.delete(serverId);
  processMetricsCache.delete(serverId);
  diskUsageCache.delete(serverId);
  try {
    const { inputPipePath } = getServerConsolePaths(serverId);
    if (fs.existsSync(inputPipePath)) fs.rmSync(inputPipePath, { force: true });
  } catch {}
  writeRuntimeState(serverId, { lastExitAt: new Date().toISOString(), pid: null, phase: "stopped" });
}

export async function stopServer(serverId: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");

  appendConsoleOutput(serverId, `[Birdserver] Stop requested at ${new Date().toISOString()}`);
  try {
    await db.update(servers).set({ status: "stopping", updatedAt: new Date() }).where(eq(servers.id, serverId));
  } catch {}
  await terminateServerProcess(serverId, "stop");

  try {
    await db.update(servers).set({ status: "stopped", pid: 0, updatedAt: new Date() }).where(eq(servers.id, serverId));
  } catch (dbError) {
    console.warn(`[Birdserver] Database stop sync skipped for ${serverId}:`, dbError);
  }
  appendConsoleOutput(serverId, `[Birdserver] Runtime stopped cleanly.`);
  return true;
}

export async function restartServer(serverId: string): Promise<boolean> {
  await stopServer(serverId);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return startServer(serverId);
}

export async function killServer(serverId: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");

  appendConsoleOutput(serverId, `[Birdserver] Kill requested at ${new Date().toISOString()}`);
  await terminateServerProcess(serverId, "kill", true);
  try {
    await db.update(servers).set({ status: "stopped", pid: 0, updatedAt: new Date() }).where(eq(servers.id, serverId));
  } catch (dbError) {
    console.warn(`[Birdserver] Database kill sync skipped for ${serverId}:`, dbError);
  }
  return true;
}

function walkStorageBytes(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) continue;
      total += stat.isDirectory() ? walkStorageBytes(target) : stat.size;
    } catch {}
  }
  return total;
}

export function getCacheSummary() {
  const temporaryRoots = [SERVERS_DIR, BACKUPS_DIR, path.join(BASE_STORAGE_DIR, "system", "theme-media")];
  const temporaryFiles: string[] = [];
  for (const root of temporaryRoots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(target);
        else if (/^(?:\.upload-|node-download-|\.extract-|failed-|.*\.tmp-)/i.test(entry.name)) temporaryFiles.push(target);
      }
    };
    walk(root);
  }
  return {
    cacheBytes: walkStorageBytes(SERVERS_DIR) + walkStorageBytes(BACKUPS_DIR),
    serverStorageBytes: walkStorageBytes(SERVERS_DIR),
    backupBytes: walkStorageBytes(BACKUPS_DIR),
    temporaryFiles: temporaryFiles.length,
    temporaryBytes: temporaryFiles.reduce((sum, target) => {
      try { return sum + fs.statSync(target).size; } catch { return sum; }
    }, 0),
    lastCleanup: null,
  };
}

export async function cleanSafeCache(mode: "cache" | "orphan" | "temp" | "all" = "all") {
  const existingServers = await db.query.servers.findMany({ columns: { id: true } });
  const serverIds = new Set(existingServers.map((server) => server.id));
  let removedFiles = 0;
  let removedBytes = 0;

  const removeIfSafe = (target: string) => {
    if (!isWithinPath(BASE_STORAGE_DIR, target) || target === BASE_STORAGE_DIR || !fs.existsSync(target)) return;
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isSymbolicLink()) removedBytes += stat.isDirectory() ? walkStorageBytes(target) : stat.size;
      fs.rmSync(target, { recursive: true, force: true });
      removedFiles += 1;
    } catch {}
  };

  if (mode === "orphan" || mode === "all") {
    if (fs.existsSync(SERVERS_DIR)) {
      for (const entry of fs.readdirSync(SERVERS_DIR, { withFileTypes: true })) {
        if (entry.isDirectory() && !serverIds.has(entry.name)) removeIfSafe(path.join(SERVERS_DIR, entry.name));
      }
    }
    const referencedBackups = new Set<string>();
    try {
      const rows = await db.query.backups.findMany({ columns: { filePath: true } });
      for (const row of rows) referencedBackups.add(path.resolve(row.filePath));
    } catch {}
    if (fs.existsSync(BACKUPS_DIR)) {
      for (const entry of fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })) {
        const target = path.join(BACKUPS_DIR, entry.name);
        if (!referencedBackups.has(path.resolve(target))) removeIfSafe(target);
      }
    }
  }

  if (mode === "temp" || mode === "all" || mode === "cache") {
    const roots = [SERVERS_DIR, path.join(BASE_STORAGE_DIR, "system", "theme-media")];
    const tempPattern = /^(?:\.upload-|node-download-|\.extract-|failed-|.*\.tmp-)/i;
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(target);
        else if (tempPattern.test(entry.name)) removeIfSafe(target);
      }
    };
    for (const root of roots) walk(root);
  }

  return { removedFiles, removedBytes, summary: getCacheSummary() };
}

const globalForMaintenance = globalThis as typeof globalThis & { __birdserverCleanupTimer?: ReturnType<typeof setInterval> };
if (!globalForMaintenance.__birdserverCleanupTimer && process.env.BIRDSERVER_DISABLE_MAINTENANCE !== "1") {
  const cleanupTimer = setInterval(() => {
    void cleanSafeCache("temp").catch((error) => {
      console.warn("[Birdserver] scheduled temporary cleanup skipped:", error instanceof Error ? error.message : error);
    });
  }, 6 * 60 * 60 * 1_000);
  cleanupTimer.unref?.();
  globalForMaintenance.__birdserverCleanupTimer = cleanupTimer;
}

export async function cleanupServerResources(serverId: string): Promise<{ removedFiles: number; removedBackupFiles: number }> {
  const serverRoot = path.resolve(SERVERS_DIR, serverId);
  if (!isWithinPath(SERVERS_DIR, serverRoot) || serverRoot === SERVERS_DIR) {
    throw new Error("SECURITY_ALERT: invalid server storage path");
  }

  await terminateServerProcess(serverId, "delete", true);
  let removedFiles = 0;
  let removedBackupFiles = 0;

  try {
    if (fs.existsSync(serverRoot)) {
      fs.rmSync(serverRoot, { recursive: true, force: true });
      removedFiles = 1;
    }
  } catch (error) {
    throw new Error(`Server storage cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const backupRows = await db.query.backups.findMany({ where: eq(backups.serverId, serverId) });
    for (const backup of backupRows) {
      const backupPath = path.resolve(backup.filePath);
      if (!isWithinPath(BACKUPS_DIR, backupPath) || backupPath === BACKUPS_DIR) continue;
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { force: true });
        removedBackupFiles += 1;
      }
    }
    await db.delete(backups).where(eq(backups.serverId, serverId));
  } catch (error) {
    console.warn(`[Birdserver] backup cleanup skipped for ${serverId}:`, error instanceof Error ? error.message : error);
  }

  return { removedFiles, removedBackupFiles };
}

export async function sendCommandToServer(serverId: string, command: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) {
    return false;
  }

  const runtimePid = readRuntimeState(serverId).pid ?? server.pid ?? null;
  if (!isPidAlive(runtimePid)) {
    return false;
  }

  const { inputLogPath, outputLogPath } = getServerConsolePaths(serverId);
  fs.appendFileSync(outputLogPath, `> ${command}\n`, "utf-8");
  fs.appendFileSync(inputLogPath, `${command}\n`, "utf-8");
  return true;
}

export function getServerMetrics(serverId: string) {
  const serverRoot = getServerDirectory(serverId);
  const state = readRuntimeState(serverId);
  const pid = state.pid ?? null;

  refreshDiskUsage(serverId, serverRoot);
  const diskBytes = diskUsageCache.get(serverId)?.bytes || 0;
  const network = refreshNetworkUsage();

  if (!pid || !isPidAlive(pid)) {
    return {
      status: "stopped",
      cpuPercent: 0,
      memoryBytes: 0,
      diskBytes,
      networkRxBytes: network.rxBytes,
      networkTxBytes: network.txBytes,
      uptimeSeconds: 0,
    };
  }

  const processMetrics = refreshProcessMetrics(serverId, pid);
  const runtimeReady = fs.existsSync(path.join(getRuntimeDirectory(serverId), "runtime-ready"));
  const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

  return {
    status: runtimeReady ? "running" : "starting",
    cpuPercent: processMetrics.cpuPercent,
    memoryBytes: processMetrics.memoryBytes,
    diskBytes,
    networkRxBytes: network.rxBytes,
    networkTxBytes: network.txBytes,
    uptimeSeconds,
  };
}

export function listDirectoryFiles(serverId: string, relPath: string = ""): FileItem[] {
  const targetDir = getSecurePath(serverId, relPath);
  if (!fs.existsSync(targetDir)) return [];

  return fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.name !== ".birdserver-runtime")
    .map((entry) => {
      const fullPath = path.join(targetDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: path.join(relPath, entry.name).replace(/\\/g, "/"),
        isDirectory: entry.isDirectory(),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        extension: entry.isDirectory() ? "" : path.extname(entry.name).slice(1),
      };
    });
}

export function readServerFile(serverId: string, relPath: string): string {
  const filePath = getSecurePath(serverId, relPath);
  if (!fs.existsSync(filePath)) throw new Error("File not found");
  return fs.readFileSync(filePath, "utf-8");
}

export function writeServerFile(serverId: string, relPath: string, content: string): void {
  const filePath = getSecurePath(serverId, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

export function createServerFolder(serverId: string, relPath: string): void {
  fs.mkdirSync(getSecurePath(serverId, relPath), { recursive: true });
}

export function deleteServerItem(serverId: string, relPath: string): void {
  const itemPath = getSecurePath(serverId, relPath);
  if (fs.existsSync(itemPath)) fs.rmSync(itemPath, { recursive: true, force: true });
}

export function renameServerItem(serverId: string, oldRelPath: string, newRelPath: string): void {
  const oldPath = getSecurePath(serverId, oldRelPath);
  const newPath = getSecurePath(serverId, newRelPath);
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.renameSync(oldPath, newPath);
}

export function copyServerItem(serverId: string, srcRelPath: string, destRelPath: string): void {
  const srcPath = getSecurePath(serverId, srcRelPath);
  const destPath = getSecurePath(serverId, destRelPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.cpSync(srcPath, destPath, { recursive: true });
}

export function moveServerItem(serverId: string, srcRelPath: string, destRelPath: string): void {
  const srcPath = getSecurePath(serverId, srcRelPath);
  const destPath = getSecurePath(serverId, destRelPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.renameSync(srcPath, destPath);
}

export async function compressServerItems(serverId: string, sources: string[], archiveName: string): Promise<string> {
  const zip = new AdmZip();
  for (const src of sources) {
    const srcPath = getSecurePath(serverId, src);
    if (!fs.existsSync(srcPath)) continue;
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) zip.addLocalFolder(srcPath, path.basename(srcPath));
    else zip.addLocalFile(srcPath);
  }

  const archiveRelPath = archiveName.endsWith(".zip") ? archiveName : `${archiveName}.zip`;
  const targetZipPath = getSecurePath(serverId, archiveRelPath);
  zip.writeZip(targetZipPath);
  return archiveRelPath;
}

export async function extractServerArchive(serverId: string, archiveRelPath: string, targetFolderRel: string = ""): Promise<boolean> {
  const archivePath = getSecurePath(serverId, archiveRelPath);
  const destDir = getSecurePath(serverId, targetFolderRel);

  // Archive extraction is CPU/memory heavy. Run AdmZip in a child process so
  // the Next.js event loop stays responsive while a large bot ZIP is unpacked.
  // The worker validates every entry before writing, so a full WhatsApp bot ZIP
  // keeps its nested folders/files without allowing Zip Slip traversal.
  const worker = `
    const fs = require("fs");
    const path = require("path");
    const AdmZip = require("adm-zip");
    const [archivePath, destDir] = process.argv.slice(1);
    const root = path.resolve(destDir);
    const zip = new AdmZip(archivePath);
    for (const entry of zip.getEntries()) {
      const target = path.resolve(root, entry.entryName);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("SECURITY_ALERT: Zip Slip path detected");
      }
    }
    fs.mkdirSync(root, { recursive: true });
    zip.extractAllTo(root, true);
  `;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", worker, archivePath, destDir], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk).slice(-4000);
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Archive extraction failed (code=${code ?? "null"}, signal=${signal ?? "none"})${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });

  return true;
}

export async function createServerBackup(serverId: string, backupName: string) {
  const serverRoot = getServerDirectory(serverId);
  const backupId = "bk_" + cryptoRandomString(12);
  const zipFileName = `${serverId}_${backupId}.zip`;
  const targetBackupPath = path.join(BACKUPS_DIR, zipFileName);

  const zip = new AdmZip();
  zip.addLocalFolder(serverRoot);
  zip.writeZip(targetBackupPath);

  const stat = fs.statSync(targetBackupPath);
  await db.insert(backups).values({
    id: backupId,
    serverId,
    name: backupName || `Backup-${new Date().toLocaleDateString()}`,
    filePath: targetBackupPath,
    fileSize: stat.size,
    isSuccessful: true,
  });

  return { backupId, filePath: targetBackupPath, size: stat.size };
}

export async function restoreServerBackup(serverId: string, backupId: string): Promise<boolean> {
  const backup = await db.query.backups.findFirst({ where: eq(backups.id, backupId) });
  if (!backup || !fs.existsSync(backup.filePath)) throw new Error("Backup file not found on disk");

  await stopServer(serverId);

  const serverRoot = getServerDirectory(serverId);
  fs.rmSync(serverRoot, { recursive: true, force: true });
  fs.mkdirSync(serverRoot, { recursive: true });

  const zip = new AdmZip(backup.filePath);
  zip.extractAllTo(serverRoot, true);
  return true;
}
