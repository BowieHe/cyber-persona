import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

interface SkillMetadata {
  name: string;
  description: string;
}

interface PersonaDefinition {
  id: string;
  displayName: string;
  soulPath: string;
  introduction?: string;
  specialties: string[];
  collaborators: string[];
  collaborationStyle?: string;
  collaborationMode: "auto" | "always" | "manual";
}

interface SkillsResponse {
  skills: SkillMetadata[];
  soul: string;
  personas: PersonaDefinition[];
}

interface ChatResponse {
  reply: string;
  skills: string[];
}

interface StreamEvent {
  type: "delta" | "skills" | "done";
  textDelta?: string;
  skills?: string[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  name: string;
  content: string;
}

const SESSION_STORAGE_KEY = "cyber-bowie.session-id";
const PERSONA_STORAGE_KEY = "cyber-bowie.persona-id";

function createSessionId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createWelcomeMessage(name: string): Message {
  return {
    id: "welcome",
    role: "assistant",
    name,
    content: `现在这页已经接上你的本地 agent 了。你可以直接用中文跟我聊；如果内容适合，我也会把 skill 一起带进来，不只是回一句漂亮话。当前在线的人格是 ${name}。`
  };
}

function createNextSession(): string {
  const sessionId = createSessionId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

function summarizeSoul(soul: string): string {
  return soul
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.startsWith("#"))
    .slice(0, 5)
    .join(" / ");
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([createWelcomeMessage("载入中")]);
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [personas, setPersonas] = useState<PersonaDefinition[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState("bowie");
  const [assistantName, setAssistantName] = useState("载入中");
  const [soulPreview, setSoulPreview] = useState("载入中...");
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const selectedPersona =
    personas.find((persona) => persona.id === selectedPersonaId) ?? personas[0] ?? null;

  useEffect(() => {
    const existingSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY) || createNextSession();
    const existingPersonaId = window.localStorage.getItem(PERSONA_STORAGE_KEY) || "bowie";

    setSessionId(existingSessionId);
    setSelectedPersonaId(existingPersonaId);
  }, []);

  useEffect(() => {
    autoResize();
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [draft, messages]);

  useEffect(() => {
    void loadMeta(selectedPersonaId);
  }, [selectedPersonaId]);

  async function loadMeta(personaId: string): Promise<void> {
    const response = await fetch(`/api/skills?personaId=${encodeURIComponent(personaId)}`);
    const data = (await response.json()) as SkillsResponse;
    const nextPersonas = data.personas.length > 0 ? data.personas : [];
    const activePersona =
      nextPersonas.find((persona) => persona.id === personaId) ?? nextPersonas[0] ?? null;
    const nextPersonaId = activePersona?.id ?? personaId;
    const nextAssistantName = activePersona?.displayName ?? "Bowie";

    setSkills(data.skills);
    setPersonas(nextPersonas);
    setAssistantName(nextAssistantName);
    setSoulPreview(summarizeSoul(data.soul));

    if (nextPersonaId !== personaId) {
      window.localStorage.setItem(PERSONA_STORAGE_KEY, nextPersonaId);
      setSelectedPersonaId(nextPersonaId);
      return;
    }

    setMessages((current) =>
      current.length === 1 && current[0]?.id === "welcome"
        ? [createWelcomeMessage(nextAssistantName)]
        : current.map((message) =>
            message.role === "assistant" ? { ...message, name: nextAssistantName } : message
          )
    );
  }

  function autoResize(): void {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }

  async function submitMessage(message: string): Promise<void> {
    const assistantMessageId = `assistant-${Date.now()}`;

    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        name: "你",
        content: message
      },
      {
        id: assistantMessageId,
        role: "assistant",
        name: assistantName,
        content: ""
      }
    ]);

    setIsLoading(true);
    setIsStreaming(true);
    requestAnimationFrame(() => {
      autoResize();
      textareaRef.current?.focus();
    });

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          sessionId,
          personaId: selectedPersonaId
        })
      });

      if (!response.ok || !response.body) {
        const fallback = (await response.json().catch(() => null)) as
          | ChatResponse
          | { error?: string }
          | null;
        throw new Error(
          fallback && "error" in fallback && fallback.error ? fallback.error : "请求失败"
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventText of events) {
          const lines = eventText
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          for (const line of lines) {
            if (!line) {
              continue;
            }

            const event = JSON.parse(line) as StreamEvent;

            if (event.type === "delta" && event.textDelta) {
              setMessages((current) =>
                current.map((item) =>
                  item.id === assistantMessageId
                    ? {
                        ...item,
                        content: item.content + event.textDelta
                      }
                    : item
                )
              );
            }
          }
        }
      }
    } catch (error: unknown) {
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantMessageId
            ? {
                ...item,
                name: "系统",
                content: `出了点问题：${error instanceof Error ? error.message : String(error)}`
              }
            : item
        )
      );
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      textareaRef.current?.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const message = draft.trim();

    if (!message || isLoading) {
      return;
    }

    await submitMessage(message);
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): Promise<void> {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const message = draft.trim();

      if (!message || isLoading) {
        return;
      }

      await submitMessage(message);
    }
  }

  function resetChat(): void {
    setMessages([createWelcomeMessage(assistantName)]);
    setDraft("");
    setSessionId(createNextSession());
    textareaRef.current?.focus();
  }

  function handlePersonaChange(personaId: string): void {
    window.localStorage.setItem(PERSONA_STORAGE_KEY, personaId);
    setSelectedPersonaId(personaId);
    setMessages([createWelcomeMessage("切换中")]);
    setDraft("");
    setSessionId(createNextSession());
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">CB</div>
          <div>
            <p className="eyebrow">Local Agent</p>
            <h1>Cyber Bowie</h1>
          </div>
        </div>

        <button className="new-chat-button" onClick={resetChat} type="button">
          开启新对话
        </button>

        <section className="sidebar-panel">
          <p className="panel-label">当前人格</p>
          <label className="persona-select-shell">
            <span className="persona-hint">切换不同 persona 的 SOUL、专长和独立记忆</span>
            <select
              className="persona-select"
              value={selectedPersonaId}
              onChange={(event) => handlePersonaChange(event.target.value)}
              disabled={isLoading}
            >
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.displayName}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="sidebar-panel">
          <p className="panel-label">人格定位</p>
          <p className="soul-preview">
            {selectedPersona?.introduction ?? "这个人格还没写 introduction，可以先从 SOUL 和 personas.json 补。"}
          </p>
        </section>

        <section className="sidebar-panel">
          <p className="panel-label">擅长领域</p>
          <div className="tag-list">
            {(selectedPersona?.specialties ?? []).length > 0 ? (
              selectedPersona?.specialties.map((specialty) => (
                <span className="tag" key={specialty}>
                  {specialty}
                </span>
              ))
            ) : (
              <span className="tag">暂未配置</span>
            )}
          </div>
          {selectedPersona?.collaborators.length ? (
            <p className="panel-footnote">
              默认会优先协作：{selectedPersona.collaborators.join("、")}
            </p>
          ) : null}
        </section>

        <section className="sidebar-panel">
          <p className="panel-label">已启用技能</p>
          <div className="tag-list">
            {skills.map((skill) => (
              <span className="tag" key={skill.name}>
                {skill.name}
              </span>
            ))}
          </div>
        </section>

        <section className="sidebar-panel">
          <p className="panel-label">人格摘要</p>
          <p className="soul-preview">{soulPreview}</p>
        </section>
      </aside>

      <main className="chat-stage">
        <header className="stage-header">
          <div>
            <p className="eyebrow">Chat View</p>
            <h2>{assistantName} 在线，用你自己的 SOUL 来聊天</h2>
            <p className="stage-subtitle">
              {selectedPersona?.specialties.length
                ? `这位现在更擅长：${selectedPersona.specialties.join("、")}`
                : "这位人格还没配置专长标签。"}
            </p>
          </div>
          <div className="status-pill">
            <span className="status-dot"></span>
            本地运行
          </div>
        </header>

        <section className="messages">
          {messages.map((message) => (
            <article
              className={`message ${message.role === "user" ? "message-user" : "message-assistant"} ${
                message.id === "welcome" ? "hero-message" : ""
              }`}
              key={message.id}
            >
              <div className="avatar">{message.role === "user" ? "你" : assistantName.slice(0, 1)}</div>
              <div className="bubble">
                <p className="message-role">{message.name}</p>
                <div className="message-content">
                  {message.content}
                  {isStreaming && message.id === messages[messages.length - 1]?.id ? (
                    <span className="stream-cursor" aria-hidden="true">
                      ▍
                    </span>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          <div ref={messageEndRef}></div>
        </section>

        <form className={`composer ${isLoading ? "is-loading" : ""}`} onSubmit={handleSubmit}>
          <label className="composer-shell" htmlFor="prompt-input">
            <textarea
              id="prompt-input"
              name="message"
              placeholder="输入你现在想做的事，例如：帮我把这个 agent 变成一个真正可接模型的产品"
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                void handleKeyDown(event);
              }}
              disabled={isLoading}
            />
            <button className="send-button" disabled={isLoading} type="submit">
              {isLoading ? "生成中..." : "送出"}
            </button>
          </label>
          <p className="composer-tip">
            {isLoading
              ? `${assistantName} 正在流式生成回复...`
              : `当前 persona：${assistantName}。Enter 送出，Shift + Enter 换行`}
          </p>
        </form>
      </main>
    </div>
  );
}
