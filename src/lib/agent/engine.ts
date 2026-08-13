import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import AdmZip from "adm-zip";
import { db } from "@/db";
import { servers, backups, templates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cryptoRandomString } from "@/lib/utils";

const BASE_STORAGE_DIR = path.resolve(process.cwd(), "storage");
const SERVERS_DIR = path.join(BASE_STORAGE_DIR, "servers");
const BACKUPS_DIR = path.join(BASE_STORAGE_DIR, "backups");

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
}

export const DEFAULT_NODE_STARTUP_COMMAND = 'if [[ -d .git ]] && [[ "{{AUTO_UPDATE}}" == "1" ]]; then git pull; fi; if [[ ! -z "${NODE_PACKAGES}" ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z "${UNNODE_PACKAGES}" ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/node /home/container/${MAIN_FILE}';

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
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
  };

  if (/telegram bot/i.test(templateCategory)) {
    return {
      ...baseEnv,
      BOT_TOKEN: "",
    };
  }

  if (/whatsapp bot/i.test(templateCategory)) {
    return {
      ...baseEnv,
      SESSION_NAME: "birdserver-wa-session",
    };
  }

  return baseEnv;
}

function resolveNodeExecutable(runtimeVersion?: string | null) {
  const normalized = (runtimeVersion || "system").trim().toLowerCase();
  if (!normalized || normalized === "system") {
    return "/usr/local/bin/node";
  }

  const version = normalized.replace(/^v/, "");
  if (/^\d+$/.test(version)) {
    return `npx -y node@${version}`;
  }

  return "/usr/local/bin/node";
}

function normalizeStartupCommand(rawCommand: string, projectRootPath: string, runtimeVersion?: string | null) {
  const nodeExecutable = resolveNodeExecutable(runtimeVersion);
  return rawCommand
    .replaceAll("/home/container", projectRootPath)
    .replaceAll("/usr/local/bin/node", nodeExecutable)
    .replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, "${$1}");
}

function resolveRuntimeWorkingDirectory(serverRoot: string, configuredWorkingDirectory?: string | null) {
  const raw = (configuredWorkingDirectory || "/home/container").trim();
  const normalized = raw.replaceAll("/home/container", serverRoot);
  const absolute = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(serverRoot, normalized);

  if (!absolute.startsWith(serverRoot)) {
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
  if (!targetPath.startsWith(serverRoot)) {
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

export function getServerConsolePaths(serverId: string) {
  const runtimeDir = getRuntimeDirectory(serverId);
  return {
    runtimeDir,
    inputLogPath: path.join(runtimeDir, "console-input.log"),
    outputLogPath: path.join(runtimeDir, "console-output.log"),
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
  fs.appendFileSync(outputLogPath, `${line}\n`, "utf-8");
}

function isPidAlive(pid: number | null | undefined) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessTreePids(rootPid: number): number[] {
  try {
    const output = execSync("ps -eo pid=,ppid=", { encoding: "utf-8" });
    const rows = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [pidStr, ppidStr] = line.split(/\s+/);
        return { pid: Number(pidStr), ppid: Number(ppidStr) };
      });

    const childrenByParent = new Map<number, number[]>();
    for (const row of rows) {
      if (!childrenByParent.has(row.ppid)) childrenByParent.set(row.ppid, []);
      childrenByParent.get(row.ppid)?.push(row.pid);
    }

    const visited = new Set<number>();
    const queue = [rootPid];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const child of childrenByParent.get(current) || []) {
        if (!visited.has(child)) queue.push(child);
      }
    }

    return Array.from(visited);
  } catch {
    return [rootPid];
  }
}

function reconcileServerRuntimeStatus(server: typeof servers.$inferSelect) {
  const alive = isPidAlive(server.pid);
  return alive ? "running" : "stopped";
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

export async function startServer(serverId: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");
  if (server.status === "suspended") throw new Error("Server is suspended");

  if (isPidAlive(server.pid)) {
    appendConsoleOutput(serverId, "[Birdserver] Server already running");
    return true;
  }

  let templateCategory = "Node.js";
  if (server.templateId) {
    const template = await db.query.templates.findFirst({ where: eq(templates.id, server.templateId) });
    if (template?.category) templateCategory = template.category;
  }

  const serverRoot = getServerDirectory(serverId);
  initializeServerFiles(serverId, templateCategory);
  const runtimeWorkingDirectory = resolveRuntimeWorkingDirectory(serverRoot, server.workingDirectory);

  const runtimeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...getDefaultServerEnv(templateCategory, runtimeWorkingDirectory),
    ...((server.envVars as Record<string, string>) || {}),
    SERVER_ID: server.id,
    BIRDSERVER: "V1",
    NODE_ENV: process.env.NODE_ENV || "production",
    PWD: runtimeWorkingDirectory,
    HOME: serverRoot,
  };

  if (!runtimeEnv.MAIN_FILE) runtimeEnv.MAIN_FILE = detectMainFile(runtimeWorkingDirectory);
  if (!runtimeEnv.AUTO_UPDATE) runtimeEnv.AUTO_UPDATE = "0";
  if (!runtimeEnv.NODE_PACKAGES) runtimeEnv.NODE_PACKAGES = "";
  if (!runtimeEnv.UNNODE_PACKAGES) runtimeEnv.UNNODE_PACKAGES = "";

  const finalStartupCommand = normalizeStartupCommand(
    server.startupCommand,
    runtimeWorkingDirectory,
    runtimeEnv.NODE_RUNTIME_VERSION
  );

  const { inputLogPath, outputLogPath } = getServerConsolePaths(serverId);
  fs.writeFileSync(inputLogPath, "", "utf-8");
  fs.appendFileSync(
    outputLogPath,
    `\n[Birdserver] ===== START ${new Date().toISOString()} =====\n[Birdserver] Server Root: ${serverRoot}\n[Birdserver] Working Dir: ${runtimeWorkingDirectory}\n[Birdserver] Startup Command: ${server.startupCommand}\n[Birdserver] Resolved Startup: ${finalStartupCommand}\n[Birdserver] MAIN_FILE=${runtimeEnv.MAIN_FILE}\n`,
    "utf-8"
  );

  const command = `tail -n 0 -F ${shellQuote(inputLogPath)} | bash -lc ${shellQuote(finalStartupCommand)} >> ${shellQuote(outputLogPath)} 2>&1`;
  const child = spawn("bash", ["-lc", command], {
    cwd: runtimeWorkingDirectory,
    env: runtimeEnv,
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  await db
    .update(servers)
    .set({ status: "running", pid: child.pid ?? null, updatedAt: new Date() })
    .where(eq(servers.id, serverId));

  writeRuntimeState(serverId, {
    startedAt: new Date().toISOString(),
    lastCommand: server.startupCommand,
    pid: child.pid ?? null,
  });

  appendConsoleOutput(serverId, `[Birdserver] Detached runtime started with PID ${child.pid}`);
  return true;
}

export async function stopServer(serverId: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");

  if (server.pid && isPidAlive(server.pid)) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      try {
        process.kill(server.pid, "SIGTERM");
      } catch {}
    }
  }

  appendConsoleOutput(serverId, `[Birdserver] Stop requested at ${new Date().toISOString()}`);
  writeRuntimeState(serverId, { lastExitAt: new Date().toISOString(), pid: null });

  await db
    .update(servers)
    .set({ status: "stopped", pid: null, updatedAt: new Date() })
    .where(eq(servers.id, serverId));

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

  if (server.pid && isPidAlive(server.pid)) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      try {
        process.kill(server.pid, "SIGKILL");
      } catch {}
    }
  }

  appendConsoleOutput(serverId, `[Birdserver] Kill requested at ${new Date().toISOString()}`);
  writeRuntimeState(serverId, { lastExitAt: new Date().toISOString(), pid: null });

  await db
    .update(servers)
    .set({ status: "stopped", pid: null, updatedAt: new Date() })
    .where(eq(servers.id, serverId));

  return true;
}

export async function sendCommandToServer(serverId: string, command: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server || !isPidAlive(server.pid)) {
    return false;
  }

  const { inputLogPath, outputLogPath } = getServerConsolePaths(serverId);
  fs.appendFileSync(outputLogPath, `> ${command}\n`, "utf-8");
  fs.appendFileSync(inputLogPath, `${command}\n`, "utf-8");
  return true;
}

export function getServerMetrics(serverId: string) {
  const serverRoot = getServerDirectory(serverId);
  let diskBytes = 0;

  const calcDirSize = (dir: string): number => {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += calcDirSize(full);
      else total += fs.statSync(full).size;
    }
    return total;
  };

  try {
    diskBytes = calcDirSize(serverRoot);
  } catch {
    diskBytes = 0;
  }

  const state = readRuntimeState(serverId);
  const pid = state.pid ?? null;

  if (!pid || !isPidAlive(pid)) {
    return {
      status: "stopped",
      cpuPercent: 0,
      memoryBytes: 0,
      diskBytes,
      uptimeSeconds: 0,
    };
  }

  let memoryBytes = 0;
  let cpuPercent = 0;

  try {
    const treePids = getProcessTreePids(pid);
    const psOut = execSync(`ps -o pid=,rss=,%cpu= -p ${treePids.join(",")}`, { encoding: "utf-8" });
    for (const line of psOut.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const [, rssStr, cpuStr] = line.split(/\s+/);
      memoryBytes += Number(rssStr || 0) * 1024;
      cpuPercent += Number(cpuStr || 0);
    }
  } catch {
    memoryBytes = 0;
    cpuPercent = 0;
  }

  const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

  return {
    status: "running",
    cpuPercent: Math.round(cpuPercent),
    memoryBytes,
    diskBytes,
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
  const zip = new AdmZip(archivePath);

  for (const entry of zip.getEntries()) {
    const entryTargetPath = path.resolve(destDir, entry.entryName);
    if (!entryTargetPath.startsWith(destDir)) {
      throw new Error("SECURITY_ALERT: Zip Slip path detected");
    }
  }

  zip.extractAllTo(destDir, true);
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
