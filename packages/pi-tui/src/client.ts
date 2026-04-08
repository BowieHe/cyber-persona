/**
 * HTTP client for debug API
 */

export interface DebugEvent {
  type: 'plan' | 'announce' | 'persona_start' | 'persona_output' | 'steering' | 'done' | 'error';
  sessionId: string;
  timestamp: number;
  payload: unknown;
}

export interface SessionInfo {
  sessionId: string;
  status: 'idle' | 'running' | 'error';
  lastActivity: number;
  activePersona?: string;
  messageCount: number;
}

export class DebugClient {
  private baseUrl: string;

  constructor(baseUrl = 'http://127.0.0.1:3000') {
    this.baseUrl = baseUrl;
  }

  async listSessions(): Promise<SessionInfo[]> {
    const response = await fetch(`${this.baseUrl}/debug/sessions`);
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.statusText}`);
    }
    return response.json() as Promise<SessionInfo[]>;
  }

  async getEvents(sessionId: string, limit = 50): Promise<DebugEvent[]> {
    const response = await fetch(
      `${this.baseUrl}/debug/events/${encodeURIComponent(sessionId)}?limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`Failed to get events: ${response.statusText}`);
    }
    return response.json() as Promise<DebugEvent[]>;
  }

  async steer(sessionId: string, message: string): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/debug/steer/${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to send steering: ${response.statusText}`);
    }
    const result = (await response.json()) as { success: boolean };
    return result.success;
  }
}
