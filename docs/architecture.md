# Cyber Bowie Architecture

## Overview

`cyber-bowie` 是一个围绕“人格化 agent”搭起来的 TypeScript monorepo。

核心目标不是只做一个会回复话的 bot，而是把这些能力拆成几层：

1. 模型接入层
2. agent runtime
3. persona / team / skill 编排
4. 接入渠道，例如 Web 和 Telegram

这样后面你要继续加 skill、加人格、换模型、换聊天入口，都不用把整套系统重写。

## Directory Map

```text
.
├─ SOUL.md
├─ personas.example.json
├─ souls/
│  ├─ critic.md
│  └─ researcher.md
├─ docs/
│  └─ architecture.md
├─ packages/
│  ├─ pi-ai/
│  ├─ pi-agent-core/
│  ├─ pi-channel-telegram/
│  ├─ pi-coding-agent/
│  ├─ pi-server/
│  ├─ pi-skills-search/
│  ├─ pi-skills-superpower/
│  └─ pi-web-chat/
└─ README.md
```

## Package Responsibilities

### `packages/pi-ai`

职责：

- 封装 OpenAI 兼容接口
- 统一 `complete` 和 `streamComplete`
- 处理错误日志、base URL、model、masked apiKey

关键文件：

- `packages/pi-ai/src/index.ts`

### `packages/pi-agent-core`

职责：

- 定义 `AgentSession`
- 维护 transcript
- 加载 SOUL
- 注册和触发 skill

关键概念：

- `AgentTask`: 一次任务的 goal / constraints / context
- `AgentSession`: 带记忆的 agent 会话
- `SkillRegistry`: skill 的注册和查找

关键文件：

- `packages/pi-agent-core/src/index.ts`

### `packages/pi-server`

职责：

- 整个项目的主服务端
- 负责 Web API、persona 加载、team 协作、会话复用
- 把 Telegram 消息路由到对应 persona

关键文件：

- `packages/pi-server/src/index.ts`
- `packages/pi-server/src/chat-service.ts`

这里是目前最重要的业务编排层。

### `packages/pi-channel-telegram`

职责：

- 解析 `TELEGRAM_BOTS_JSON`
- long polling Telegram Bot API
- 处理 mention / reply / alias 判断
- 把 Telegram update 变成统一消息结构

关键文件：

- `packages/pi-channel-telegram/src/index.ts`

### `packages/pi-web-chat`

职责：

- 本地 Web UI
- persona 切换
- 流式聊天展示
- 显示当前 persona 的专长和摘要

关键文件：

- `packages/pi-web-chat/web/src/App.tsx`
- `packages/pi-web-chat/web/src/styles.css`

### `packages/pi-skills-superpower`

职责：

- 提供一个轻量、默认启用的内建 skill
- 帮 agent 抓重点和差异化方向

### `packages/pi-skills-search`

职责：

- 从 finpal 抽出来的搜索 skill
- 支持拆问题、多轮搜索、结果回顾、置信度提升
- 通过 MCP 调外部搜索

## Persona System

现在 persona 系统有三层来源：

1. 根 `SOUL.md`
2. `souls/<personaId>.md`
3. `personas.json`

### `SOUL.md`

默认人格。`personaId = bowie` 时优先读取它。

### `souls/*.md`

额外人格的 SOUL 文件。服务端会自动扫描。

### `personas.json`

这个文件是“团队配置”，不是 SOUL 本体。它负责定义：

- 这个人格擅长什么
- 默认协作找谁
- 自我介绍
- 协作风格
- 是否自动协作

推荐流程是：

1. 用 `SOUL.md / souls/*.md` 定人格语气和行为
2. 用 `personas.json` 定团队关系和专长分工

## Collaboration Flow

当用户把消息发给某个 persona 时，`ChatService` 会做这些事：

1. 解析当前 persona
2. 读取团队成员列表
3. 判断这条消息是否值得协作
4. 按 `collaborators` 选择 1 到 `PERSONA_COLLAB_MAX_PEERS` 个队友
5. 让队友分别给出“内部意见”
6. 把这些内部意见塞回主 persona 的上下文
7. 由主 persona 输出最终答复

所以现在的人格关系不是“多个孤岛”，而是：

- 每个人格保留自己的记忆
- 主人格可以在复杂问题上拉队友一起看
- 最终输出仍然保持主 persona 的语气

## Session Model

会话 key 现在是：

```text
personaId::sessionId
```

意思是：

- 同一个聊天窗口里，不同 persona 记忆是分开的
- 同一个 Telegram 用户对不同 bot 说话，也会进不同 persona session

这是为了避免人格串味。

## Web Flow

Web 请求路径：

1. 前端调用 `/api/skills?personaId=...`
2. 服务端返回 persona 列表、SOUL 摘要、技能列表
3. 用户发送消息到 `/api/chat/stream`
4. 服务端按 persona 跑协作编排
5. 前端流式显示回复

## Telegram Flow

Telegram 请求路径：

1. server 启动时读取 `TELEGRAM_BOTS_JSON`
2. 每个 bot 启动一个 long polling loop
3. 收到 update 后判断是否应该响应
4. 转成统一消息结构
5. 按 bot 绑定的 `personaId` 路由到 `ChatService`
6. 再调用 Telegram `sendMessage`

## Why The Server Is The Center

这个项目现在是“服务端中心化”架构，原因很现实：

- Web 和 Telegram 都要共用会话与人格系统
- skill 调用不应该散在多个入口里
- Telegram bot 之间本身不能自然互相聊天
- 多人格协作最好在一个统一编排层里完成

所以 `pi-server` 是当前真正的中枢。

## Key Files To Read First

如果后续你想快速接手，建议按这个顺序看：

1. `packages/pi-server/src/chat-service.ts`
2. `packages/pi-server/src/index.ts`
3. `packages/pi-agent-core/src/index.ts`
4. `packages/pi-channel-telegram/src/index.ts`
5. `packages/pi-web-chat/web/src/App.tsx`
6. `packages/pi-skills-search/src/index.ts`

## Where To Extend Next

如果你后面继续扩：

- 加新人格：新增 `souls/<id>.md`，再补 `personas.json`
- 加新 skill：在 `packages/` 新建 skill 包，然后在 `ChatService.createAgentSession()` 注册
- 加新接入渠道：参考 `pi-channel-telegram` 再做一个 channel 包
- 做更强的多人格协作：在 `ChatService` 上面再抽一层 orchestrator

## Current Limitations

当前版本已经能做“主 persona + 队友协作”，但还不是完整议会系统。

还没做的包括：

- 多人格互相来回多轮讨论
- 人格之间共享长期团队记忆
- 基于任务类型自动选择最佳 persona
- 协作过程的可视化

这不是做不到，只是我刻意把第一版停在一个更稳、更容易继续长大的点。
