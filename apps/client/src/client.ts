import { Socket, connect } from "net";
import { EventEmitter } from "events";
import {
  extractFrame,
  encodeFrame,
} from "../../../packages/protocol/src/frame.js";
import { MessageType } from "../../../packages/protocol/src/constants.js";
import type { ParsedFrame } from "../../../packages/protocol/src/types.js";

/**
 * RelayClient - TCP client for connecting to Relay server
 */
export class RelayClient extends EventEmitter {
  private socket: Socket | null = null;
  private recvBuffer: Buffer = Buffer.alloc(0);
  private connected: boolean = false;

  /**
   * Connect to Relay server
   */
  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(port, host);

      this.socket.once("connect", () => {
        this.connected = true;
        this.wireSocket();
        this.emit("connected");
        resolve();
      });

      this.socket.once("error", (err) => {
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  /**
   * Wire socket events
   */
  private wireSocket(): void {
    if (!this.socket) return;

    this.socket.on("data", (chunk: Buffer) => {
      this.onData(chunk);
    });

    this.socket.on("close", () => {
      this.connected = false;
      this.emit("disconnected");
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });
  }

  /**
   * Handle incoming data
   */
  private onData(chunk: Buffer): void {
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
    this.parse();
  }

  /**
   * Parse frames from buffer
   */
  private parse(): void {
    while (true) {
      const result = extractFrame(this.recvBuffer);
      if (!result) break;

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

        this.emit("frame", parsed);
      } catch (err) {
        this.emit("error", err);
      }
    }
  }

  /**
   * Send a frame
   */
  send(type: MessageType, payload?: unknown): void {
    if (!this.connected || !this.socket) {
      throw new Error("Not connected");
    }

    const { buffer } = encodeFrame(type, payload);
    this.socket.write(buffer);
  }

  /**
   * Send HELLO
   */
  hello(userId: string): void {
    this.send(MessageType.HELLO, { userId, clientVersion: "1.0.0" });
  }

  /**
   * Join a room
   */
  joinRoom(roomName: string): void {
    this.send(MessageType.JOIN_ROOM, { room: roomName });
  }

  /**
   * Leave a room
   */
  leaveRoom(roomName: string): void {
    this.send(MessageType.LEAVE_ROOM, { room: roomName });
  }

  /**
   * Send a message to a room
   */
  sendMessage(roomName: string, content: string): void {
    this.send(MessageType.MESSAGE, { room: roomName, content });
  }

  /**
   * Send heartbeat
   */
  heartbeat(): void {
    this.send(MessageType.HEARTBEAT);
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}
