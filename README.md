# cyber-bowie

A personal TypeScript monorepo inspired by `pi-mono`, with a local `SOUL.md` persona file and a pluggable skill system.

## Packages

- `@cyber-bowie/pi-ai`: lightweight model/provider abstractions
- `@cyber-bowie/pi-agent-core`: reusable agent runtime, soul loading, and skill registry
- `@cyber-bowie/pi-coding-agent`: CLI coding assistant
- `@cyber-bowie/pi-server`: unified agent server for web and channel adapters
- `@cyber-bowie/pi-channel-clawbot`: clawbot/wechat channel adapter
- `@cyber-bowie/pi-skills-superpower`: first built-in skill package
- `@cyber-bowie/pi-skills-search`: portable deep-search skill extracted from finpal
- `@cyber-bowie/pi-web-chat`: local React + TypeScript web UI with a ChatGPT-like layout

## Getting started

```bash
npm install
npm run build
cp .env.example .env
# 填入你的 OPENAI_API_KEY
npm run build
npm run agent -- --list-skills
npm run agent -- --skill superpower "帮我设计一个个人项目结构"
npm run server
npm run web
```

Then open `http://localhost:3000`.

## Soul

The root [SOUL.md](/home/bowie/code/cyber-bowie/SOUL.md) file defines the assistant's personality, tone, working style, and guardrails.

## Skills

- Skills can be registered into the agent runtime.
- `superpower` is enabled by default in the CLI.
- More skills can be ported later using the same interface.

## Web UI

- ChatGPT-like sidebar + conversation layout
- Served by `pi-server`
- Frontend implemented with React + TypeScript
- Uses `SOUL.md` and the built-in `superpower` skill

## Server Architecture

- `pi-server` is the main runtime entry for HTTP APIs and channel adapters.
- `pi-web-chat` is now only the frontend bundle.
- `pi-channel-clawbot` is the normalization layer for future WeChat/ClawBot access.

## Server Endpoints

- `GET /api/health`
- `GET /api/skills`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/channel/clawbot`

Example ClawBot-style payload:

```json
{
  "sessionId": "wechat-room-001",
  "userId": "wx-user-123",
  "text": "你是谁"
}
```

如果配置了 `CLAWBOT_WEBHOOK_TOKEN`，请求需要带上以下任一请求头：

- `Authorization: Bearer <token>`
- `X-Clawbot-Token: <token>`

## OpenAI 配置

项目通过 `.env` 读取模型配置，最少需要：

```bash
OPENAI_API_KEY=你的密钥
OPENAI_MODEL=gpt-4.1-mini
```

可选配置：

```bash
OPENAI_BASE_URL=
OPENAI_TEMPERATURE=0.4
MCP_SEARCH_URL=
MCP_SEARCH_TOOL=bailian_web_search
MCP_SEARCH_AUTH_TOKEN=
MCP_SEARCH_AUTH_HEADER=Authorization
MCP_SEARCH_RESULT_COUNT=10
CLAWBOT_WEBHOOK_TOKEN=
PORT=3000
HOST=127.0.0.1
```

CLI 和 Web 都会读取同一份 `.env`。

如果你要启用接近 `finpal` 的外部搜索 skill，还需要配置 MCP 搜索服务：

- `MCP_SEARCH_URL`: MCP HTTP 服务地址
- `MCP_SEARCH_TOOL`: 要调用的工具名
- `MCP_SEARCH_AUTH_TOKEN`: 可选，鉴权 token
- `MCP_SEARCH_AUTH_HEADER`: 可选，默认 `Authorization`
- `CLAWBOT_WEBHOOK_TOKEN`: 可选，保护 `clawbot` webhook 入口

## Notes

- This is a clean-room personal implementation inspired by the structure of `pi-mono`.
- `.codex` and `codex` are ignored via `.gitignore`.
