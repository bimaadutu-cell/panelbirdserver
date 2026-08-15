import fs from "fs";
import path from "path";
import { authorizeServerRequest } from "@/lib/server-access";
import { getServerConsolePaths } from "@/lib/agent/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_INITIAL_BYTES = 128 * 1024;

function getLastLines(text: string, count: number) {
  return text.split(/\r?\n/).filter(Boolean).slice(-count);
}

async function readTail(filePath: string, maxBytes = MAX_INITIAL_BYTES) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - maxBytes);
    const length = Math.max(0, stat.size - start);
    const buffer = Buffer.allocUnsafe(length);
    if (length) await handle.read(buffer, 0, length, start);
    return { text: buffer.toString("utf8"), size: stat.size };
  } finally {
    await handle.close();
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeServerRequest(req, id);
  if (!auth.ok) return auth.response;

  const { outputLogPath } = getServerConsolePaths(id);
  await fs.promises.mkdir(path.dirname(outputLogPath), { recursive: true });

  try {
    await fs.promises.access(outputLogPath);
  } catch {
    await fs.promises.writeFile(
      outputLogPath,
      "[Birdserver] Server is currently offline.\n",
      "utf8"
    );
  }

  const encoder = new TextEncoder();
  const initial = await readTail(outputLogPath);
  let lastSize = initial.size;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let polling = false;

      const sendLine = (line: string) => {
        if (closed || !line) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ line })}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      for (const line of getLastLines(initial.text, 160)) sendLine(line);

      const interval = setInterval(async () => {
        if (closed || polling) return;
        polling = true;

        try {
          const stats = await fs.promises.stat(outputLogPath);
          if (stats.size < lastSize) lastSize = 0;

          if (stats.size > lastSize) {
            const handle = await fs.promises.open(outputLogPath, "r");
            try {
              const length = stats.size - lastSize;
              const buffer = Buffer.allocUnsafe(length);
              await handle.read(buffer, 0, length, lastSize);
              lastSize = stats.size;

              for (const line of buffer.toString("utf8").split(/\r?\n/).filter(Boolean)) {
                sendLine(line);
              }
            } finally {
              await handle.close();
            }
          }
        } catch {
          // Keep the stream alive through log rotation/restarts.
        } finally {
          polling = false;
        }
      }, 350);

      req.signal.addEventListener("abort", () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      // The request abort handler owns interval cleanup.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
