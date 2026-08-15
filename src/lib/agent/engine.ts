import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import { createHash } from "crypto";
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

export const DEFAULT_NODE_STARTUP_COMMAND = 'node /home/container/${MAIN_FILE}';

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
  if (/telegram|whatsapp|node/i.test(category || "")) return "23";
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
  if (!Number.isInteger(major) || major < 18 || major > 25) {
    throw new Error(`Unsupported Node.js runtime version: ${version}. Use system or a Node.js major from 18 to 25.`);
  }

  const runtimeVersion = version.includes(".") ? version : ({
    18: "18.20.8",
    20: "20.20.2",
    22: "22.23.2",
    23: "23.11.1",
    24: "24.18.1",
    25: "25.9.0",
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

    const download = (url: string, output: string) => {
      const env = { ...process.env, PATH: buildRuntimePath(process.env.PATH) };
      const curl = detectHostBinary("curl", "");
      const wget = detectHostBinary("wget", "");
      if (curl) {
        execSync(
          `${shellQuote(curl)} --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 600 ${shellQuote(url)} --output ${shellQuote(output)}`,
          { cwd: tmpRoot, env, stdio: "inherit" }
        );
        return;
      }
      if (wget) {
        execSync(
          `${shellQuote(wget)} --https-only --tries=3 --timeout=20 --server-response --output-document=${shellQuote(output)} ${shellQuote(url)}`,
          { cwd: tmpRoot, env, stdio: "inherit" }
        );
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
          download(`${baseUrl}/${archive}`, archivePath);
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
        download(`${baseUrl}/SHASUMS256.txt`, sumsPath);
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
    const actual = createHash("sha256").update(fs.readFileSync(downloadedArchive)).digest("hex");
    if (actual !== expected) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      throw new Error(`Node.js runtime checksum mismatch for ${archiveName}.`);
    }

    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });

    const tarArgs = downloadedArchive.endsWith(".tar.xz")
      ? `-xJf ${shellQuote(downloadedArchive)}`
      : `-xzf ${shellQuote(downloadedArchive)}`;
    execSync(`tar ${tarArgs} -C ${shellQuote(tmpRoot)}`, { cwd: tmpRoot, stdio: "inherit" });

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
  } catch {}

  // Some hosted Linux environments can reject process.kill(pid, 0) even
  // though the process is visible to the same container. Fall back to ps.
  try {
    const output = execSync(`ps -p ${Math.trunc(pid)} -o pid=`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output === String(Math.trunc(pid));
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
  initializeServerFiles(serverId, templateCategory);
  const runtimeWorkingDirectory = resolveRuntimeWorkingDirectory(serverRoot, server.workingDirectory);
  const runtimeContainerAlias = prepareRuntimeContainerAlias(serverId, runtimeWorkingDirectory);

  const initialEnv = {
    ...getDefaultServerEnv(templateCategory, runtimeWorkingDirectory),
    ...((server.envVars as Record<string, string>) || {}),
  };
  const selectedNodeVersion = normalizeNodeVersion(initialEnv.NODE_RUNTIME_VERSION, server.dockerImage, templateCategory);
  const runtime = await ensureNodeRuntime(serverId, selectedNodeVersion);

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
  };

  if (!runtimeEnv.MAIN_FILE) runtimeEnv.MAIN_FILE = detectMainFile(runtimeWorkingDirectory);
  if (!runtimeEnv.AUTO_UPDATE) runtimeEnv.AUTO_UPDATE = "0";
  if (!runtimeEnv.NODE_PACKAGES) runtimeEnv.NODE_PACKAGES = "";
  if (!runtimeEnv.UNNODE_PACKAGES) runtimeEnv.UNNODE_PACKAGES = "";
  if (!runtimeEnv.npm_config_include) runtimeEnv.npm_config_include = "dev";

  const rawStartupCommand = (server.startupCommand || DEFAULT_NODE_STARTUP_COMMAND).trim();
  const normalizedStartupCommand = normalizeStartupCommand(rawStartupCommand, runtimeContainerAlias, runtime);

  // Always perform real dependency installation on the host before starting
  // the uploaded project. This is intentionally not a fake/simulated status:
  // npm/pip/apt commands execute against the actual Railway runtime filesystem.
  const hasExplicitNodeInstall = /\bnpm\s+(?:install|ci)\b/.test(rawStartupCommand);
  const dependencyStatePath = path.join(getRuntimeDirectory(serverId), "dependency-state.txt");
  const dependencyStateShellPath = shellQuote(dependencyStatePath);
  const npmInstall = `if command -v nice >/dev/null 2>&1; then nice -n 10 ${shellQuote(runtime.npm)} install --no-audit --no-fund --prefer-online; else ${shellQuote(runtime.npm)} install --no-audit --no-fund --prefer-online; fi`;

  const dependencyBootstrap = [
    'set -e',
    `echo '[Birdserver] Node runtime: ${runtime.version} (selected=${selectedNodeVersion})'`,
    // Do not run a full npm install on every restart. This is one of the
    // biggest sources of unnecessary CPU/network contention on a shared host.
    // Install only when node_modules is missing or package metadata changed.
    `if [[ -f package.json ]] && ${hasExplicitNodeInstall ? 'false' : 'true'}; then if ! command -v ${shellQuote(runtime.npm)} >/dev/null 2>&1; then echo '[Birdserver] npm is unavailable for the selected Node runtime.'; exit 127; fi; DEP_SIG="$(stat -c '%Y:%s' package.json 2>/dev/null || true):$(stat -c '%Y:%s' package-lock.json 2>/dev/null || true):$(stat -c '%Y:%s' npm-shrinkwrap.json 2>/dev/null || true)"; NEED_NPM=0; if [[ ! -d node_modules || ! -f ${dependencyStateShellPath} || "$(cat ${dependencyStateShellPath} 2>/dev/null || true)" != "$DEP_SIG" ]]; then NEED_NPM=1; fi; if [[ "$NEED_NPM" == "1" ]]; then echo '[Birdserver] Installing Node dependencies (background-safe mode)...'; ${npmInstall}; printf '%s' "$DEP_SIG" > ${dependencyStateShellPath}; else echo '[Birdserver] Dependencies already up to date; skipping npm install.'; fi; fi`,
    'if [[ ! -z "${NODE_PACKAGES}" ]]; then ' + shellQuote(runtime.npm) + ' install --no-audit --no-fund ${NODE_PACKAGES}; fi',
    'if [[ ! -z "${UNNODE_PACKAGES}" ]]; then ' + shellQuote(runtime.npm) + ' uninstall ${UNNODE_PACKAGES}; fi',
    `if [[ -f requirements.txt ]]; then if ! command -v python3 >/dev/null 2>&1; then echo '[Birdserver] requirements.txt exists but python3 is unavailable.'; exit 127; fi; python3 -m pip install --no-input -r requirements.txt || python3 -m pip install --no-input --user -r requirements.txt; fi`,
    'if [[ ! -z "${PYTHON_PACKAGES}" ]]; then if ! command -v python3 >/dev/null 2>&1; then echo "[Birdserver] PYTHON_PACKAGES requested but python3 is unavailable."; exit 127; fi; python3 -m pip install --no-input --user ${PYTHON_PACKAGES} || python3 -m pip install --no-input ${PYTHON_PACKAGES}; fi',
    'if [[ ! -z "${OS_PACKAGES}" ]]; then if ! command -v apt-get >/dev/null 2>&1 || [[ "$(id -u)" != "0" ]]; then echo "[Birdserver] OS_PACKAGES requested, but apt-get/root access is unavailable on this host."; exit 126; fi; DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${OS_PACKAGES}; fi',
  ].join('; ');
  const finalStartupCommand = `${dependencyBootstrap}; ${normalizedStartupCommand}`;

  const { inputLogPath, outputLogPath } = getServerConsolePaths(serverId);
  fs.writeFileSync(inputLogPath, "", "utf-8");
  fs.appendFileSync(
    outputLogPath,
    `\n[Birdserver] ===== START ${new Date().toISOString()} =====\n[Birdserver] Server Root: ${serverRoot}\n[Birdserver] Working Dir: ${runtimeWorkingDirectory}\n[Birdserver] Container Alias: ${runtimeContainerAlias}\n[Birdserver] Startup Command: ${server.startupCommand}\n[Birdserver] Resolved Startup: ${finalStartupCommand}\n[Birdserver] MAIN_FILE=${runtimeEnv.MAIN_FILE}\n[Birdserver] NODE_BIN=${hostBinaries.node}\n[Birdserver] NPM_BIN=${hostBinaries.npm}\n[Birdserver] NPX_BIN=${hostBinaries.npx}\n[Birdserver] PATH=${runtimeEnv.PATH}\n`,
    "utf-8"
  );

  // IMPORTANT: do not keep the console tail process as part of the runtime
  // process group. The old implementation used `tail -F | bash -lc ...`,
  // which could keep the server marked RUNNING forever after the bot crashed.
  // The FIFO feeds live console commands while the actual startup command
  // remains the lifetime of the tracked PID.
  const inputPipePath = path.join(getRuntimeDirectory(serverId), "console-input.pipe");
  try {
    if (fs.existsSync(inputPipePath)) fs.rmSync(inputPipePath, { force: true });
  } catch {}

  // A real FIFO keeps console input usable across HTTP requests without
  // making `tail -F` the tracked server PID. The trap removes the feeder
  // process and FIFO when the actual bot exits.
  const command = [
    `mkfifo -m 600 ${shellQuote(inputPipePath)}`,
    `trap 'kill "$feeder" 2>/dev/null || true; rm -f ${shellQuote(inputPipePath)}' EXIT TERM INT`,
    `tail -n 0 -F ${shellQuote(inputLogPath)} > ${shellQuote(inputPipePath)} & feeder=$!`,
    `${hostBinaries.bash} -lc ${shellQuote(finalStartupCommand)} < ${shellQuote(inputPipePath)} >> ${shellQuote(outputLogPath)} 2>&1`,
  ].join("; ");
  const child = spawn(hostBinaries.bash, ["-lc", command], {
    cwd: runtimeWorkingDirectory,
    env: runtimeEnv,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });

  child.on("exit", (code, signal) => {
    const exitMessage = `[Birdserver] Runtime exited (code=${code ?? "null"}, signal=${signal ?? "none"}).`;
    appendConsoleOutput(serverId, exitMessage);
    writeRuntimeState(serverId, { lastExitAt: new Date().toISOString(), pid: null });
    void db.update(servers)
      .set({ status: "stopped", pid: 0, updatedAt: new Date() })
      .where(eq(servers.id, serverId))
      .catch((error) => console.warn(`[Birdserver] Exit status sync skipped for ${serverId}:`, error));
  });
  child.unref();

  // Persist runtime state first. The process itself is the source of truth
  // for the live status page, so a hosted-Postgres write failure must never
  // turn a successfully started process into a failed START request.
  const runtimePid = child.pid ?? 0;
  writeRuntimeState(serverId, {
    startedAt: new Date().toISOString(),
    lastCommand: server.startupCommand,
    pid: runtimePid,
    lastExitAt: undefined,
  });

  try {
    await db
      .update(servers)
      .set({ status: "running", pid: runtimePid, updatedAt: new Date() })
      .where(eq(servers.id, serverId));
  } catch (dbError) {
    console.warn(`[Birdserver] Database status sync skipped for ${serverId}:`, dbError);
    appendConsoleOutput(serverId, `[Birdserver] Runtime status is active.`);
  }

  appendConsoleOutput(serverId, `[Birdserver] Detached runtime started with PID ${runtimePid}`);
  appendConsoleOutput(serverId, `[Birdserver] Dependency mode: real host runtime (npm/pip/OS packages where available).`);
  return true;
}

export async function stopServer(serverId: string): Promise<boolean> {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");

  const runtimePid = readRuntimeState(serverId).pid ?? server.pid ?? null;
  if (runtimePid && isPidAlive(runtimePid)) {
    try {
      process.kill(-runtimePid, "SIGTERM");
    } catch {
      try {
        process.kill(runtimePid, "SIGTERM");
      } catch {}
    }
  }

  appendConsoleOutput(serverId, `[Birdserver] Stop requested at ${new Date().toISOString()}`);
  writeRuntimeState(serverId, { lastExitAt: new Date().toISOString(), pid: null });

  try {
    await db
      .update(servers)
      // PID 0 is the persisted "not running" sentinel.
      .set({ status: "stopped", pid: 0, updatedAt: new Date() })
      .where(eq(servers.id, serverId));
  } catch (dbError) {
    console.warn(`[Birdserver] Database stop sync skipped for ${serverId}:`, dbError);
    appendConsoleOutput(serverId, `[Birdserver] Runtime stopped.`);
  }

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

  const runtimePid = readRuntimeState(serverId).pid ?? server.pid ?? null;
  if (runtimePid && isPidAlive(runtimePid)) {
    try {
      process.kill(-runtimePid, "SIGKILL");
    } catch {
      try {
        process.kill(runtimePid, "SIGKILL");
      } catch {}
    }
  }

  appendConsoleOutput(serverId, `[Birdserver] Kill requested at ${new Date().toISOString()}`);
  writeRuntimeState(serverId, { lastExitAt: new Date().toISOString(), pid: null });

  try {
    await db
      .update(servers)
      // PID 0 is the persisted "not running" sentinel.
      .set({ status: "stopped", pid: 0, updatedAt: new Date() })
      .where(eq(servers.id, serverId));
  } catch (dbError) {
    console.warn(`[Birdserver] Database stop sync skipped for ${serverId}:`, dbError);
    appendConsoleOutput(serverId, `[Birdserver] Runtime stopped.`);
  }

  return true;
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

interface CachedMetrics {
  value: {
    status: "running" | "stopped";
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
    uptimeSeconds: number;
  };
  expiresAt: number;
  refreshing: boolean;
}

const metricsCache = new Map<string, CachedMetrics>();

function calculateDiskBytesFast(serverRoot: string): Promise<number> {
  return new Promise((resolve) => {
    const { execFile } = require("child_process") as typeof import("child_process");
    execFile("du", ["-sb", "--", serverRoot], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) return resolve(0);
      const bytes = Number(String(stdout).trim().split(/\s+/)[0]);
      resolve(Number.isFinite(bytes) ? bytes : 0);
    });
  });
}

function collectMetricsAsync(serverId: string): Promise<CachedMetrics["value"]> {
  return new Promise(async (resolve) => {
    const serverRoot = getServerDirectory(serverId);
    const state = readRuntimeState(serverId);
    const pid = state.pid ?? null;

    if (!pid || !isPidAlive(pid)) {
      resolve({
        status: "stopped",
        cpuPercent: 0,
        memoryBytes: 0,
        diskBytes: await calculateDiskBytesFast(serverRoot),
        uptimeSeconds: 0,
      });
      return;
    }

    const { execFile } = require("child_process") as typeof import("child_process");
    // Do not synchronously walk the whole process tree on every poll.\n    // The tracked runtime PID is enough for the hot metrics path.\n    const treePids = [pid];\n    const diskPromise = calculateDiskBytesFast(serverRoot);

    execFile(
      "ps",
      ["-o", "pid=,rss=,%cpu=", "-p", treePids.join(",")],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
      async (_error, stdout) => {
        let memoryBytes = 0;
        let cpuPercent = 0;

        for (const line of String(stdout || "").split("\n").map((v) => v.trim()).filter(Boolean)) {
          const parts = line.split(/\s+/);
          const rss = Number(parts[1] || 0);
          const cpu = Number(parts[2] || 0);
          if (Number.isFinite(rss)) memoryBytes += rss * 1024;
          if (Number.isFinite(cpu)) cpuPercent += cpu;
        }

        const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
        const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

        resolve({
          status: "running",
          cpuPercent: Math.round(cpuPercent),
          memoryBytes,
          diskBytes: await diskPromise,
          uptimeSeconds,
        });
      }
    );
  });
}

/**
 * Non-blocking metrics API.
 *
 * The old implementation recursively scanned the whole server directory and
 * synchronously ran `ps` on every poll. A large `node_modules` install could
 * therefore block the Next.js event loop and freeze the entire web panel.
 * Metrics are now cached and refreshed in the background so API requests
 * return immediately even while npm/pip is busy.
 */
export function getServerMetrics(serverId: string) {
  const now = Date.now();
  const cached = metricsCache.get(serverId);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const fallback = cached?.value || {
    status: "stopped" as const,
    cpuPercent: 0,
    memoryBytes: 0,
    diskBytes: 0,
    uptimeSeconds: 0,
  };

  if (!cached || !cached.refreshing) {
    const entry: CachedMetrics = {
      value: fallback,
      expiresAt: now + 2000,
      refreshing: true,
    };
    metricsCache.set(serverId, entry);

    void collectMetricsAsync(serverId)
      .then((value) => {
        metricsCache.set(serverId, {
          value,
          expiresAt: Date.now() + 2000,
          refreshing: false,
        });
      })
      .catch(() => {
        metricsCache.set(serverId, {
          value: fallback,
          expiresAt: Date.now() + 2000,
          refreshing: false,
        });
      });
  }

  return fallback;
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
