import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  createTelegramSessionId,
  parseTelegramBotConfigs,
  startTelegramPolling
} from "@cyber-bowie/pi-channel-telegram";
import { ChatService } from "./chat-service.js";

loadEnv({
  path: resolve(process.cwd(), ".env"),
  override: true
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const currentFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(currentFile), "..");
const webDistDir = resolve(packageRoot, "..", "pi-web-chat", "web", "dist");
const chatService = new ChatService({
  cwd: process.cwd()
});

interface ChatRequestBody {
  message?: string;
  sessionId?: string;
  personaId?: string;
}

interface ResponseSpec {
  statusCode: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

function jsonResponse(data: unknown, statusCode = 200): ResponseSpec {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(data)
  };
}

async function readJsonBody<T>(request: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

async function serveStatic(pathname: string): Promise<ResponseSpec> {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(webDistDir, normalizedPath);
  const file = await readFile(filePath);
  const extension = extname(filePath);

  const mimeTypeMap: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": mimeTypeMap[extension] ?? "application/octet-stream"
    },
    body: file
  };
}

async function main(): Promise<void> {
  const telegramBots = parseTelegramBotConfigs(process.env.TELEGRAM_BOTS_JSON);
  const telegramController =
    telegramBots.length > 0
      ? startTelegramPolling({
          bots: telegramBots,
          async onMessage(event) {
            const result = await chatService.buildReply(event.message.text, {
              personaId: event.bot.personaId,
              sessionId: createTelegramSessionId(event.message)
            });

            return {
              text: result.reply,
              replyToMessageId: event.message.messageId
            };
          },
          log(level, message, meta) {
            const line =
              meta === undefined
                ? `[telegram:${level}] ${message}`
                : `[telegram:${level}] ${message} ${JSON.stringify(meta)}`;
            process.stdout.write(`${line}\n`);
          }
        })
      : null;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

      if (request.method === "GET" && url.pathname === "/api/health") {
        const payload = jsonResponse({
          ok: true,
          service: "pi-server",
          telegramBots: telegramBots.length
        });
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/skills") {
        const personaId = url.searchParams.get("personaId")?.trim() || undefined;
        const payload = jsonResponse(await chatService.getSkillsAndSoul(personaId));
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJsonBody<ChatRequestBody>(request);
        const message = body.message?.trim();
        const sessionId = body.sessionId?.trim();
        const personaId = body.personaId?.trim();

        if (!message) {
          const payload = jsonResponse({ error: "message 不能为空" }, 400);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }

        const payload = jsonResponse(
          await chatService.buildReply(message, {
            sessionId: sessionId || undefined,
            personaId: personaId || undefined
          })
        );
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/chat/stream") {
        const body = await readJsonBody<ChatRequestBody>(request);
        const message = body.message?.trim();
        const sessionId = body.sessionId?.trim();
        const personaId = body.personaId?.trim();

        if (!message) {
          const payload = jsonResponse({ error: "message 不能为空" }, 400);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }

        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        });

        for await (const event of chatService.streamReply(message, {
          sessionId: sessionId || undefined,
          personaId: personaId || undefined
        })) {
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        response.end();
        return;
      }

      if (request.method === "GET") {
        const payload = await serveStatic(url.pathname);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      const payload = jsonResponse({ error: "不支持的请求" }, 404);
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const payload = jsonResponse({ error: message }, 500);
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    }
  });

  const shutdown = async () => {
    if (telegramController) {
      await telegramController.stop();
    }

    server.closeAllConnections?.();
    server.close();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  server.listen(port, host, () => {
    process.stdout.write(`pi-server running at http://${host}:${port}\n`);
  });
}

void main();
