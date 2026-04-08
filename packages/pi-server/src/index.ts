import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  createTelegramSessionId,
  startTelegramPolling
} from "@cyber-bowie/pi-channel-telegram";
import { loadBotConfig, validateBotsConfig } from "./bot-config.js";
import { ChatService } from "./chat-service.js";
import { initCronJobs } from "./cron.js";
import { debugAPI } from "./debug-api.js";

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

// 初始化定时任务（仅在 ENABLE_CRON=true 时启用）
initCronJobs(chatService);

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
  const botConfigs = loadBotConfig();
  validateBotsConfig(botConfigs);
  const telegramController =
    botConfigs.length > 0
      ? startTelegramPolling({
          bots: botConfigs,
          async onMessage(event, sendMessage) {
            const { bot, message } = event;
            const sessionId = createTelegramSessionId(event.message);
            
            console.log(`[Telegram] Received message: ${message.text.substring(0, 50)}...`);
            
            // Group 消息路由逻辑
            if (message.chatType === 'group' || message.chatType === 'supergroup') {
              // 检查是否 @mention 了某个 bot
              const mentionedUsername = message.mentions[0]; // 取第一个 @mention

              if (mentionedUsername) {
                // 如果 @mention 了其他 bot，当前 bot 忽略
                const myUsername = bot.username?.toLowerCase();
                if (myUsername && mentionedUsername !== myUsername) {
                  console.log(`[Telegram] Ignoring: message is for @${mentionedUsername}`);
                  return undefined;
                }
              } else {
                // 没有 @mention，只有主 bot (bowie) 处理，避免重复响应
                if (bot.personaId !== 'bowie') {
                  console.log(`[Telegram] Ignoring: no mention, only bowie responds`);
                  return undefined;
                }
              }
            }

            // 使用 orchestrateReply，即时发送每条消息

            for await (const item of chatService.orchestrateReply(message.text, {
              sessionId
            })) {
              if (item.type === "announce") {
                // Orchestrator 开场白
                await sendMessage(`[呱吉] ${item.text}`);
                console.log(`[Orchestrator] Sent announce`);
              } else {
                // Persona 回复
                await sendMessage(`[${item.displayName}] ${item.text}`);
                console.log(`[${item.personaId}] Sent reply`);
              }
              
              // 稍微停顿，让对话更自然
              await new Promise(r => setTimeout(r, 600));
            }
            
            // 返回 void（表示已自行发送）
            return undefined;
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

      // Debug API routes
      if (url.pathname.startsWith("/debug/")) {
        // GET /debug/sessions - 列出所有活跃会话
        if (request.method === "GET" && url.pathname === "/debug/sessions") {
          const payload = jsonResponse(debugAPI.listSessions());
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }

        // GET /debug/events/:sessionId?limit=50 - 获取会话事件
        if (request.method === "GET" && url.pathname.startsWith("/debug/events/")) {
          const sessionId = url.pathname.slice("/debug/events/".length);
          const limit = Number(url.searchParams.get("limit") ?? "50");
          const payload = jsonResponse(debugAPI.getEvents(sessionId, limit));
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }

        // POST /debug/steer/:sessionId - 发送 steering 消息
        if (request.method === "POST" && url.pathname.startsWith("/debug/steer/")) {
          const sessionId = url.pathname.slice("/debug/steer/".length);
          const body = await readJsonBody<{ message: string }>(request);
          const success = debugAPI.steer(sessionId, body.message);
          const payload = jsonResponse({ success });
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }

        // 404 for unknown debug routes
        const payload = jsonResponse({ error: "Unknown debug endpoint" }, 404);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        const payload = jsonResponse({
          ok: true,
          service: "pi-server",
          botConfigs: botConfigs.length
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

      // 删除 /api/chat/stream，因为 orchestrateReply 已经支持即时发送
      // 如果需要 Web 流式，后续可以实现 WebSocket 版本

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
