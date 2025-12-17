import { Socket } from "net";
import { EventEmitter } from "events";
import { extractFrame, encodeFrame } from "../../../protocol/src/frame.js";
import type { ParsedFrame } from "../../../protocol/src/types.js";
import {
  MessageType,
  MAX_FRAME_SIZE,
} from "../../../protocol/src/constants.js";

export enum ConnectionState {
  INIT = "INIT",
  OPEN = "OPEN",
  DRAINING = "DRAINING",
  CLOSING = "CLOSING",
  CLOSED = "CLOSED",
}

export interface ConnectionEvents {
  open: (connectionId: string) => void;
  frame: (frame: ParsedFrame) => void;
  heartbeat: (receivedAt: number) => void;
  drain: (queuedFrames: number) => void;
  error: (error: {
    type: "transport" | "protocol";
    reason: string;
    fatal: boolean;
  }) => void;
  close: (stats: {
    reason?: string;
    bytesSent: number;
    bytesReceived: number;
  }) => void;
  state: (state: ConnectionState) => void;
}

/**
 * Connection represents one client's TCP connection lifecycle.
 *
 * Responsibilities:
 * - Receive buffering and incremental frame parsing
 * - Backpressure handling for outbound writes
 * - State machine enforcement (INIT → OPEN ⟷ DRAINING → CLOSING → CLOSED)
 * - Event emission for parsed frames
 *
 * Does NOT:
 * - Interpret message semantics
 * - Handle routing or rooms
 * - Manage other connections
 */
export class Connection extends EventEmitter {
  private socket: Socket;
  private state: ConnectionState = ConnectionState.INIT;
  public readonly connectionId: string;

  // Buffering / parsing state
  private recvBuffer: Buffer = Buffer.alloc(0);

  // Statistics
  private bytesSent: number = 0;
  private bytesReceived: number = 0;
  private lastHeartbeatAt: number = Date.now();

  constructor(socket: Socket, connectionId: string) {
    super();
    this.socket = socket;
    this.connectionId = connectionId;
    this.wireSocket();
    this.transition(ConnectionState.OPEN);
    this.emit("open", connectionId);
  }

  /**
   * Bind socket events to Connection behavior
   */
  private wireSocket(): void {
    // Data event
    this.socket.on("data", (chunk: Buffer) => {
      if (this.state === ConnectionState.CLOSED) return;
      this.bytesReceived += chunk.length;
      this.onData(chunk);
    });

    // Drain event
    this.socket.on("drain", () => {
      if (this.state === ConnectionState.DRAINING) {
        this.transition(ConnectionState.OPEN);
        this.emit("drain", 0);
      }
    });

    // Close event
    this.socket.on("close", () => {
      this.handleClose();
    });

    // Error event
    this.socket.on("error", (err) => {
      this.emit("error", {
        type: "transport",
        reason: err.message,
        fatal: true,
      });
      this.close();
    });
  }

  /**
   * Handle incoming data chunk
   */
  private onData(chunk: Buffer): void {
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
    this.parse();
  }

  /**
   * Incremental frame parser
   *
   * Extracts complete frames from the receive buffer.
   * Handles fragmentation and frame coalescing correctly.
   */
  private parse(): void {
    while (true) {
      // Safety check: prevent memory exhaustion
      if (this.recvBuffer.length > MAX_FRAME_SIZE) {
        this.emit("error", {
          type: "protocol",
          reason: `Receive buffer exceeded limit: ${this.recvBuffer.length} bytes`,
          fatal: true,
        });
        this.close();
        return;
      }

      const result = extractFrame(this.recvBuffer);

      if (!result) {
        return;
      }

      const { frame, remaining } = result;
      this.recvBuffer = remaining;

      try {
        // Decode payload based on flags
        let payload: unknown = null;

        if (frame.payload.length > 0) {
          if (frame.flags & 0b00000001) {
            // UTF-8 JSON
            const json = frame.payload.toString("utf8");
            payload = JSON.parse(json);
          } else if (frame.flags & 0b00000010) {
            // Binary
            payload = frame.payload;
          } else {
            // Unknown encoding, keep as buffer
            payload = frame.payload;
          }
        }

        const parsed: ParsedFrame = {
          version: frame.version,
          type: frame.type,
          flags: frame.flags,
          payload,
        };

        // Special handling for heartbeat
        if (parsed.type === MessageType.HEARTBEAT) {
          this.lastHeartbeatAt = Date.now();
          this.emit("heartbeat", this.lastHeartbeatAt);
        } else {
          // Emit parsed frame for higher layers
          this.emit("frame", parsed);
        }
      } catch (err) {
        this.emit("error", {
          type: "protocol",
          reason: err instanceof Error ? err.message : String(err),
          fatal: true,
        });
        this.close();
        return;
      }
    }
  }

  /**
   * Send a frame to the client
   *
   * @param type - Message type
   * @param payload - Payload data
   */
  send(type: MessageType, payload?: unknown): void {
    if (
      this.state !== ConnectionState.OPEN &&
      this.state !== ConnectionState.DRAINING
    ) {
      // Silently drop if not in writable state
      return;
    }

    try {
      const { buffer } = encodeFrame(type, payload);
      this.bytesSent += buffer.length;

      const canWrite = this.socket.write(buffer);

      if (!canWrite && this.state === ConnectionState.OPEN) {
        this.transition(ConnectionState.DRAINING);
      }
    } catch (err) {
      this.emit("error", {
        type: "transport",
        reason: err instanceof Error ? err.message : String(err),
        fatal: false,
      });
    }
  }

  /**
   * Close the connection gracefully
   */
  close(): void {
    if (
      this.state === ConnectionState.CLOSING ||
      this.state === ConnectionState.CLOSED
    ) {
      return;
    }

    this.transition(ConnectionState.CLOSING);
    this.socket.end();
  }

  /**
   * Handle socket close event
   */
  private handleClose(): void {
    if (this.state === ConnectionState.CLOSED) return;

    this.transition(ConnectionState.CLOSED);
    this.emit("close", {
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
    });
  }

  /**
   * Transition to a new state
   */
  private transition(next: ConnectionState): void {
    if (this.state === next) return;

    // Enforce state machine rules
    const allowed = this.isTransitionAllowed(this.state, next);
    if (!allowed) {
      throw new Error(`Invalid state transition: ${this.state} → ${next}`);
    }

    this.state = next;
    this.emit("state", next);
  }

  /**
   * Check if a state transition is valid
   */
  private isTransitionAllowed(
    from: ConnectionState,
    to: ConnectionState
  ): boolean {
    const transitions: Record<ConnectionState, ConnectionState[]> = {
      [ConnectionState.INIT]: [ConnectionState.OPEN],
      [ConnectionState.OPEN]: [
        ConnectionState.DRAINING,
        ConnectionState.CLOSING,
        ConnectionState.CLOSED,
      ],
      [ConnectionState.DRAINING]: [
        ConnectionState.OPEN,
        ConnectionState.CLOSING,
        ConnectionState.CLOSED,
      ],
      [ConnectionState.CLOSING]: [ConnectionState.CLOSED],
      [ConnectionState.CLOSED]: [],
    };

    return transitions[from]?.includes(to) ?? false;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      connectionId: this.connectionId,
      state: this.state,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      lastHeartbeatAt: this.lastHeartbeatAt,
      bufferSize: this.recvBuffer.length,
    };
  }
}
