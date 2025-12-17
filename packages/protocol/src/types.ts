/**
 * Protocol Type Definitions
 */

import { MessageType } from "./constants.js";

/**
 * A complete frame as it appears on the wire
 */
export type Frame = {
  length: number; // Total frame length (header + payload)
  version: number; // Protocol version
  type: MessageType; // Message type
  flags: number; // Flags bitmask
  payload: Buffer; // Raw payload bytes
};

/**
 * Parsed frame with decoded payload
 */
export type ParsedFrame = {
  version: number;
  type: MessageType;
  flags: number;
  payload: unknown; // Decoded based on flags (JSON object or Buffer)
};

/**
 * Frame encoding result
 */
export type EncodedFrame = {
  buffer: Buffer; // Complete frame ready to send
};
