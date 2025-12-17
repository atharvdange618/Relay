/**
 * Centralized logging with debug mode support
 */

import { config } from "../config.js";
import type { ParsedFrame } from "../../../../packages/protocol/src/types.js";
import { MessageType } from "../../../../packages/protocol/src/constants.js";

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

class Logger {
  private debugEnabled: boolean;

  constructor() {
    this.debugEnabled = config.debug;
  }

  /**
   * Format timestamp
   */
  private timestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format log message
   */
  private format(level: LogLevel, message: string, meta?: unknown): string {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${this.timestamp()}] [${level}] ${message}${metaStr}`;
  }

  /**
   * Debug logs (only when RELAY_DEBUG=1)
   */
  debug(message: string, meta?: unknown): void {
    if (this.debugEnabled) {
      console.log(this.format(LogLevel.DEBUG, message, meta));
    }
  }

  /**
   * Info logs
   */
  info(message: string, meta?: unknown): void {
    console.log(this.format(LogLevel.INFO, message, meta));
  }

  /**
   * Warning logs
   */
  warn(message: string, meta?: unknown): void {
    console.warn(this.format(LogLevel.WARN, message, meta));
  }

  /**
   * Error logs
   */
  error(message: string, meta?: unknown): void {
    console.error(this.format(LogLevel.ERROR, message, meta));
  }

  /**
   * Log connection event
   */
  connection(connectionId: string, event: string, meta?: unknown): void {
    const message = `[${connectionId}] ${event}`;
    if (this.debugEnabled) {
      this.debug(message, meta);
    } else {
      this.info(message);
    }
  }

  /**
   * Log frame details (debug only)
   */
  frame(connectionId: string, direction: "→" | "←", frame: ParsedFrame): void {
    if (!this.debugEnabled) return;

    const typeName = MessageType[frame.type] || `UNKNOWN(${frame.type})`;
    const payloadSize = frame.payload
      ? Buffer.isBuffer(frame.payload)
        ? frame.payload.length
        : JSON.stringify(frame.payload).length
      : 0;

    this.debug(`[${connectionId}] ${direction} Frame`, {
      type: typeName,
      version: frame.version,
      flags: `0b${frame.flags.toString(2).padStart(8, "0")}`,
      payloadSize: `${payloadSize}B`,
    });
  }

  /**
   * Log state transition (debug only)
   */
  stateTransition(
    connectionId: string,
    from: string,
    to: string,
    reason?: string
  ): void {
    if (!this.debugEnabled) return;

    this.debug(
      `[${connectionId}] State: ${from} → ${to}`,
      reason ? { reason } : undefined
    );
  }

  /**
   * Log backpressure event (debug only)
   */
  backpressure(connectionId: string, event: "detected" | "relieved"): void {
    if (!this.debugEnabled) return;

    const emoji = event === "detected" ? "🔴" : "🟢";
    this.debug(`[${connectionId}] ${emoji} Backpressure ${event}`);
  }

  /**
   * Log buffer state (debug only)
   */
  bufferState(connectionId: string, size: number, action: string): void {
    if (!this.debugEnabled) return;

    this.debug(`[${connectionId}] Buffer ${action}`, { size: `${size}B` });
  }
}

export const logger = new Logger();
