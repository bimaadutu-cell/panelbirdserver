import fs from "fs";
import path from "path";
import { authorizeServerRequest } from "@/lib/server-access";
import { getServerConsolePaths } from "@/lib/agent/engine";

export const dynamic = "force-dynamic";

function getLastLines(text: string, count: number) {
  return text.split(/\r?\n/).filter(Boolean).slice(-count);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeServerRequest(req, id);
  if (!auth.ok) return auth.response;

  const { outputLogPath } = getServerConsolePaths(id);

  fs.mkdirSync(path.dirname(outputLogPath), { recursive: true });
  if (!fs.existsSync(outputLogPath)) {
    fs.writeFileSync(outputLogPath, "[Birdserver] Server is currently offline.\n", "utf-8");
  }

  const encoder = new TextEncoder();
  let lastSize = fs.statSync(outputLogPath).size;

  const stream = new ReadableStream({
    start(controller) {
      const initialText = fs.readFileSync(outputLogPath, "utf-8");
      for (const line of getLastLines(initialText, 200)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
      }

      const interval = setInterval(() => {
        try {
          const stats = fs.statSync(outputLogPath);
          if (stats.size < lastSize) lastSize = 0;

          if (stats.size > lastSize) {
            const fd = fs.openSync(outputLogPath, "r");
            const buffer = Buffer.alloc(stats.size - lastSize);
            fs.readSync(fd, buffer, 0, buffer.length, lastSize);
            fs.closeSync(fd);
            lastSize = stats.size;

            const text = buffer.toString("utf-8");
            for (const line of text.split(/\r?\n/).filter(Boolean)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
            }
          }
        } catch {
          // ignore polling errors while file rotates
        }
      }, 700);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
