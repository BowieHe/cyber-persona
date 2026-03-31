# @cyber-bowie/pi-channel-clawbot

This package is the message normalization layer between channel payloads and the agent server.

## Current status

- Provides a normalized inbound message format
- Accepts flexible `clawbot`-like webhook payloads
- Returns a normalized outbound reply structure
- Session continuity is handled by `pi-server` using `sessionId + userId`
- Optional token auth is controlled by `CLAWBOT_WEBHOOK_TOKEN`

## Expected minimal payload

```json
{
  "sessionId": "wechat-room-001",
  "userId": "wx-user-123",
  "text": "请介绍一下你自己"
}
```

## Webhook auth

If `CLAWBOT_WEBHOOK_TOKEN` is configured, include one of:

```http
Authorization: Bearer <token>
```

or

```http
X-Clawbot-Token: <token>
```

## Accepted alternative keys

- `content`
- `prompt`
- `conversationId`
- `chatId`
- nested `message.text`
- nested `user.id`
- nested `session.id`

## Notes

The exact Tencent/ClawBot production callback format may differ. This adapter is intentionally tolerant so we can plug in the real payload shape later without rewriting the agent core.
