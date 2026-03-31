import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  buildClawbotOutbound,
  parseClawbotInbound
} from "@cyber-bowie/pi-channel-clawbot";
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

function getBearerToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith("Bearer ") ? trimmed.slice("Bearer ".length).trim() : trimmed;
}

function validateClawbotRequest(request: import("node:http").IncomingMessage): boolean {
  const configuredToken = process.env.CLAWBOT_WEBHOOK_TOKEN?.trim();

  if (!configuredToken) {
    return true;
  }

  const authorization = getBearerToken(request.headers.authorization);
  const headerToken = getBearerToken(
    typeof request.headers["x-clawbot-token"] === "string"
      ? request.headers["x-clawbot-token"]
      : undefined
  );

  return authorization === configuredToken || headerToken === configuredToken;
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

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      const payload = jsonResponse({
        ok: true,
        service: "pi-server"
      });
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/skills") {
      const payload = jsonResponse(await chatService.getSkillsAndSoul());
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJsonBody<ChatRequestBody>(request);
      const message = body.message?.trim();
      const sessionId = body.sessionId?.trim();

      if (!message) {
        const payload = jsonResponse({ error: "message 不能为空" }, 400);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      const payload = jsonResponse(await chatService.buildReply(message, sessionId || undefined));
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat/stream") {
      const body = await readJsonBody<ChatRequestBody>(request);
      const message = body.message?.trim();
      const sessionId = body.sessionId?.trim();

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

      for await (const event of chatService.streamReply(message, sessionId || undefined)) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/channel/clawbot") {
      if (!validateClawbotRequest(request)) {
        const payload = jsonResponse(
          {
            error: "clawbot webhook token 无效"
          },
          401
        );
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      const body = await readJsonBody<unknown>(request);
      const inbound = parseClawbotInbound(body);

      if (!inbound) {
        const payload = jsonResponse(
          {
            error: "无法识别 clawbot 消息格式，请调整 adapter payload"
          },
          400
        );
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      const result = await chatService.buildReply(
        inbound.text,
        `${inbound.channel}:${inbound.sessionId}:${inbound.userId}`
      );
      const payload = jsonResponse(buildClawbotOutbound(inbound, result.reply));
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
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
}).listen(port, host, () => {
  process.stdout.write(`pi-server running at http://${host}:${port}\n`);
});
