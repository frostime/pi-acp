import type { AgentSideConnection, SessionUpdate } from '@agentclientprotocol/sdk'
import { bashTerminalOutputMeta } from './translate/bash.js'

type BufferedChunk =
  | { kind: 'agent-message'; text: string; bytes: number }
  | { kind: 'agent-thought'; text: string; bytes: number }
  | { kind: 'terminal-output'; toolCallId: string; text: string; bytes: number }

type SessionUpdatePumpOptions = {
  flushDelayMs?: number
  maxBufferedBytes?: number
}

const DEFAULT_FLUSH_DELAY_MS = 25
const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024

export class SessionUpdatePump {
  private readonly flushDelayMs: number
  private readonly maxBufferedBytes: number
  private bufferedChunk: BufferedChunk | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private lastDelivery: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly conn: AgentSideConnection,
    private readonly sessionId: string,
    options: SessionUpdatePumpOptions = {}
  ) {
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES
  }

  appendAgentMessage(text: string): void {
    this.appendChunk({ kind: 'agent-message', text, bytes: Buffer.byteLength(text) })
  }

  appendAgentThought(text: string): void {
    this.appendChunk({ kind: 'agent-thought', text, bytes: Buffer.byteLength(text) })
  }

  appendTerminalOutput(toolCallId: string, text: string): void {
    this.appendChunk({ kind: 'terminal-output', toolCallId, text, bytes: Buffer.byteLength(text) })
  }

  send(update: SessionUpdate): void {
    if (this.disposed) return

    // Structural updates are ordering barriers: all earlier streamed content must
    // reach the client before tool, retry, error, or lifecycle state changes.
    this.flushBufferedChunk()
    this.enqueue(update)
  }

  async flush(): Promise<void> {
    this.flushBufferedChunk()
    await this.lastDelivery
  }

  dispose(): void {
    this.disposed = true
    this.clearFlushTimer()
    this.bufferedChunk = null
  }

  private appendChunk(next: BufferedChunk): void {
    if (this.disposed || next.text.length === 0) return

    if (this.bufferedChunk && canMerge(this.bufferedChunk, next)) {
      if (this.bufferedChunk.bytes + next.bytes > this.maxBufferedBytes) {
        this.flushBufferedChunk()
        this.bufferedChunk = next
        this.scheduleFlush()
      } else {
        this.bufferedChunk.text += next.text
        this.bufferedChunk.bytes += next.bytes
      }
    } else {
      this.flushBufferedChunk()
      this.bufferedChunk = next
      this.scheduleFlush()
    }

    if (this.bufferedChunk.bytes >= this.maxBufferedBytes) this.flushBufferedChunk()
  }

  private scheduleFlush(): void {
    this.flushTimer = setTimeout(() => this.flushBufferedChunk(), this.flushDelayMs)
    this.flushTimer.unref?.()
  }

  private flushBufferedChunk(): void {
    const chunk = this.bufferedChunk
    if (!chunk || this.disposed) return

    this.bufferedChunk = null
    this.clearFlushTimer()
    this.enqueue(toSessionUpdate(chunk))
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return
    clearTimeout(this.flushTimer)
    this.flushTimer = null
  }

  private enqueue(update: SessionUpdate): void {
    this.lastDelivery = this.lastDelivery
      .then(() => {
        if (this.disposed) return
        return this.conn.sessionUpdate({ sessionId: this.sessionId, update })
      })
      .catch(() => {
        // A disconnected client must not prevent the active prompt from settling.
      })
  }
}

function canMerge(current: BufferedChunk, next: BufferedChunk): boolean {
  if (current.kind !== next.kind) return false
  if (current.kind !== 'terminal-output' || next.kind !== 'terminal-output') return true
  return current.toolCallId === next.toolCallId
}

function toSessionUpdate(chunk: BufferedChunk): SessionUpdate {
  switch (chunk.kind) {
    case 'agent-message':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: chunk.text }
      }
    case 'agent-thought':
      return {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: chunk.text }
      }
    case 'terminal-output':
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: chunk.toolCallId,
        status: 'in_progress',
        _meta: bashTerminalOutputMeta(chunk.toolCallId, chunk.text)
      }
  }
}
