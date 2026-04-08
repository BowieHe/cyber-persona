/**
 * Debug API for TUI panel
 * Provides HTTP endpoints for observing and controlling chat sessions
 *
 * Steering机制说明：
 * - 用户在Orchestrator执行过程中发送的干预消息
 * - 不中断当前正在执行的persona
 * - 在下一个persona执行前，将steering内容加入上下文
 * - 影响后续persona的回复
 */

export interface DebugEvent {
  type: 'plan' | 'announce' | 'persona_start' | 'persona_output' | 'steering' | 'done' | 'error';
  sessionId: string;
  timestamp: number;
  payload: unknown;
}

interface SessionInfo {
  sessionId: string;
  status: 'idle' | 'running' | 'error';
  lastActivity: number;
  activePersona?: string;
  messageCount: number;
}

// Circular buffer for event storage per session
class CircularBuffer<T> {
  private buffer: T[] = [];
  private pointer = 0;

  constructor(private capacity: number) {}

  push(item: T): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(item);
    } else {
      this.buffer[this.pointer] = item;
      this.pointer = (this.pointer + 1) % this.capacity;
    }
  }

  last(count: number): T[] {
    if (this.buffer.length === 0) return [];
    if (count >= this.buffer.length) return [...this.buffer];

    // Return last N items in chronological order
    const result: T[] = [];
    const start = this.pointer;
    for (let i = 0; i < count; i++) {
      const idx = (start - count + i + this.buffer.length) % this.buffer.length;
      result.push(this.buffer[idx]);
    }
    return result;
  }

  get all(): T[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
    this.pointer = 0;
  }
}

export class DebugAPI {
  private eventBuffers = new Map<string, CircularBuffer<DebugEvent>>();
  // Steering队列：用户干预消息，影响后续persona执行
  private steeringQueues = new Map<string, string[]>();
  private sessionStatus = new Map<string, SessionInfo>();
  private readonly maxEventsPerSession = 1000;

  /**
   * Record an event for a session
   */
  recordEvent(sessionId: string, event: Omit<DebugEvent, 'sessionId' | 'timestamp'>): void {
    if (!this.eventBuffers.has(sessionId)) {
      this.eventBuffers.set(sessionId, new CircularBuffer<DebugEvent>(this.maxEventsPerSession));
      this.sessionStatus.set(sessionId, {
        sessionId,
        status: 'running',
        lastActivity: Date.now(),
        messageCount: 0
      });
    }

    const fullEvent: DebugEvent = {
      ...event,
      sessionId,
      timestamp: Date.now()
    };

    this.eventBuffers.get(sessionId)!.push(fullEvent);

    // Update session status
    const status = this.sessionStatus.get(sessionId)!;
    status.lastActivity = Date.now();
    if (event.type === 'done') {
      status.status = 'idle';
    } else if (event.type === 'error') {
      status.status = 'error';
    } else if (event.type === 'persona_start') {
      status.activePersona = (event.payload as { personaId: string }).personaId;
    }
    status.messageCount++;
  }

  /**
   * Get recent events for a session
   */
  getEvents(sessionId: string, limit = 50): DebugEvent[] {
    return this.eventBuffers.get(sessionId)?.last(limit) ?? [];
  }

  /**
   * List all active sessions
   */
  listSessions(): SessionInfo[] {
    // Clean up old sessions (inactive for > 30 minutes)
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [sessionId, status] of this.sessionStatus.entries()) {
      if (status.lastActivity < cutoff) {
        this.eventBuffers.delete(sessionId);
        this.steeringQueues.delete(sessionId);
        this.sessionStatus.delete(sessionId);
      }
    }

    return Array.from(this.sessionStatus.values());
  }

  /**
   * Add a steering message to a session
   * Steering消息会被加入队列，在下一个persona执行前影响其上下文
   */
  steer(sessionId: string, message: string): boolean {
    if (!this.sessionStatus.has(sessionId)) {
      return false;
    }

    const queue = this.steeringQueues.get(sessionId) ?? [];
    queue.push(message);
    this.steeringQueues.set(sessionId, queue);

    // Record the steering event for display
    this.recordEvent(sessionId, {
      type: 'steering',
      payload: { message }
    });

    return true;
  }

  /**
   * Drain steering queue for a session
   * 由orchestrateReply在下一个persona执行前调用
   * 返回并清空队列中的steering消息
   */
  drainSteering(sessionId: string): string[] {
    const queue = this.steeringQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      return [];
    }
    const messages = [...queue];
    this.steeringQueues.set(sessionId, []);
    return messages;
  }

  /**
   * Check if there's pending steering for a session
   */
  hasSteering(sessionId: string): boolean {
    const queue = this.steeringQueues.get(sessionId);
    return queue !== undefined && queue.length > 0;
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): SessionInfo | null {
    return this.sessionStatus.get(sessionId) ?? null;
  }

  /**
   * Mark session as complete
   */
  completeSession(sessionId: string): void {
    const status = this.sessionStatus.get(sessionId);
    if (status) {
      status.status = 'idle';
      status.activePersona = undefined;
    }

    // Record completion event
    this.recordEvent(sessionId, {
      type: 'done',
      payload: {}
    });
  }
}

// Singleton instance
export const debugAPI = new DebugAPI();
