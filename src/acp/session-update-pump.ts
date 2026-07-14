/**
 * SPEC — SessionUpdatePump
 *
 * Purpose
 * Pi can produce text, thought, and terminal deltas faster than an ACP client
 * can render individual notifications. Coalesced mode reduces that
 * amplification without changing the concatenated content or the observable
 * event order.
 *
 * Mode selection
 * - PI_ACP_SESSION_UPDATE_MODE is read at ACP agent initialization. A session
 *   cannot switch mode while it is active.
 * - coalesced is the default. It groups compatible stream chunks by time and
 *   byte limits.
 * - legacy is a diagnostic and benchmark fallback. It sends every stream
 *   delta through the same ordered writer without coalescing.
 *
 * Delivery contract
 * - One writer serializes all session updates in FIFO order.
 * - Only consecutive chunks with the same semantic kind may be coalesced.
 *   Terminal chunks additionally require the same tool-call ID.
 * - send() is an ordering barrier: buffered stream content is enqueued before
 *   the non-coalescible update.
 * - flush() enqueues the current chunk and waits for all delivery work that was
 *   queued before the call.
 * - dispose() abandons buffered and not-yet-started delivery work. An update
 *   already being written may still complete.
 * - Client delivery failures are contained here so a disconnected client
 *   cannot leave an ACP prompt permanently unsettled.
 *
 * Boundaries
 * The time and byte thresholds bound chunk granularity and latency; they do not
 * impose hard backpressure on Pi stdout or cap the total queue if the client
 * stops consuming. Pi event interpretation, turn completion, cancellation, and
 * retry policy remain owned by PiAcpSession.
 *
 * Change rules
 * Preserve lossless concatenation, FIFO barriers, terminal tool identity, and
 * prompt-completion flushing. A new coalescing rule requires tests proving both
 * content equivalence and ordering across adjacent structural updates.
 */
import type { AgentSideConnection, SessionUpdate } from '@agentclientprotocol/sdk'
import { bashTerminalOutputMeta } from './translate/bash.js'

type BufferedChunk =
  | { kind: 'agent-message'; text: string; bytes: number }
  | { kind: 'agent-thought'; text: string; bytes: number }
  | { kind: 'terminal-output'; toolCallId: string; text: string; bytes: number }

export type SessionUpdateMode = 'coalesced' | 'legacy'

export type SessionUpdatePumpOptions = {
  mode?: SessionUpdateMode
  flushDelayMs?: number
  maxBufferedBytes?: number
}

const DEFAULT_MODE: SessionUpdateMode = 'coalesced'
const DEFAULT_FLUSH_DELAY_MS = 25
const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024

export function parseSessionUpdateMode(value: string | undefined): SessionUpdateMode {
  if (value === undefined || value === 'coalesced') return 'coalesced'
  if (value === 'legacy') return 'legacy'
  throw new Error('PI_ACP_SESSION_UPDATE_MODE must be "coalesced" or "legacy"')
}

export class SessionUpdatePump {
  private readonly mode: SessionUpdateMode
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
    this.mode = options.mode ?? DEFAULT_MODE
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES
  }

  appendAgentMessage(text: string): void {
    this.appendStreamChunk({ kind: 'agent-message', text, bytes: Buffer.byteLength(text) })
  }

  appendAgentThought(text: string): void {
    this.appendStreamChunk({ kind: 'agent-thought', text, bytes: Buffer.byteLength(text) })
  }

  appendTerminalOutput(toolCallId: string, text: string): void {
    this.appendStreamChunk({ kind: 'terminal-output', toolCallId, text, bytes: Buffer.byteLength(text) })
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

  private appendStreamChunk(next: BufferedChunk): void {
    if (this.mode === 'legacy') {
      this.send(toSessionUpdate(next))
      return
    }

    this.appendCoalescedChunk(next)
  }

  private appendCoalescedChunk(next: BufferedChunk): void {
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
