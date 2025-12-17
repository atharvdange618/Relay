/**
 * Frame Encoding and Decoding
 *
 * Implements the binary protocol:
 * | length (4B) | version (1B) | type (1B) | flags (1B) | payload (variable) |
 *
 * All numeric fields use Big Endian (network byte order).
 */

import {
  PROTOCOL_VERSION,
  HEADER_SIZE,
  FLAG_UTF8_JSON,
  FLAG_BINARY,
  MessageType,
} from "./constants.js";
import type { Frame, ParsedFrame, EncodedFrame } from "./types.js";
import { ProtocolError } from "./errors.js";

/**
 * Encode a frame for transmission
 *
 * @param type - Message type
 * @param payload - Payload data (object for JSON, Buffer for binary)
 * @param flags - Optional flags (auto-detected if not provided)
 */
export function encodeFrame(
  type: MessageType,
  payload?: unknown,
  flags?: number
): EncodedFrame {
  let payloadBuffer: Buffer;
  let computedFlags = flags ?? 0;

  // Encode payload based on type
  if (payload === undefined || payload === null) {
    payloadBuffer = Buffer.alloc(0);
  } else if (Buffer.isBuffer(payload)) {
    payloadBuffer = payload;
    computedFlags |= FLAG_BINARY;
  } else {
    // Assume JSON-serializable object
    const json = JSON.stringify(payload);
    payloadBuffer = Buffer.from(json, "utf8");
    computedFlags |= FLAG_UTF8_JSON;
  }

  // Calculate total length (header + payload, excluding length field itself)
  const totalLength = HEADER_SIZE - 4 + payloadBuffer.length; // version + type + flags + payload
  const buffer = Buffer.alloc(4 + totalLength);

  // Write header
  buffer.writeUInt32BE(totalLength, 0); // length
  buffer.writeUInt8(PROTOCOL_VERSION, 4); // version
  buffer.writeUInt8(type, 5); // type
  buffer.writeUInt8(computedFlags, 6); // flags

  // Write payload
  payloadBuffer.copy(buffer, 7);

  return { buffer };
}

/**
 * Decode a complete frame
 *
 * @param frameBuffer - Complete frame buffer (excluding the 4-byte length prefix)
 * @returns Parsed frame with decoded payload
 */
export function decodeFrame(frameBuffer: Buffer): ParsedFrame {
  if (frameBuffer.length < HEADER_SIZE - 4) {
    throw new ProtocolError(
      `Frame too short: expected at least ${HEADER_SIZE - 4} bytes, got ${
        frameBuffer.length
      }`
    );
  }

  // Parse header
  const version = frameBuffer.readUInt8(0);
  const type = frameBuffer.readUInt8(1) as MessageType;
  const flags = frameBuffer.readUInt8(2);

  // Extract payload
  const payloadBytes = frameBuffer.subarray(3);

  // Decode payload based on flags
  let payload: unknown = null;

  if (payloadBytes.length > 0) {
    if (flags & FLAG_UTF8_JSON) {
      // Decode as UTF-8 JSON
      try {
        const json = payloadBytes.toString("utf8");
        payload = JSON.parse(json);
      } catch (err) {
        throw new ProtocolError(`Invalid JSON payload: ${err}`);
      }
    } else if (flags & FLAG_BINARY) {
      // Keep as raw buffer
      payload = payloadBytes;
    } else {
      // Unknown encoding, keep as buffer
      payload = payloadBytes;
    }
  }

  return {
    version,
    type,
    flags,
    payload,
  };
}

/**
 * Extract a complete frame from buffer (used by Connection parser)
 *
 * @param buffer - Receive buffer
 * @returns Frame object if complete, null if more data needed
 */
export function extractFrame(
  buffer: Buffer
): { frame: Frame; remaining: Buffer } | null {
  // Need at least 4 bytes for length
  if (buffer.length < 4) {
    return null;
  }

  // Read frame length
  const frameLength = buffer.readUInt32BE(0);

  // Calculate total bytes needed (4-byte length prefix + frame content)
  const totalSize = 4 + frameLength;

  // Not enough data yet
  if (buffer.length < totalSize) {
    return null;
  }

  // Extract frame (without length prefix)
  const frameBuffer = buffer.subarray(4, totalSize);

  // Parse frame
  const version = frameBuffer.readUInt8(0);
  const type = frameBuffer.readUInt8(1) as MessageType;
  const flags = frameBuffer.readUInt8(2);
  const payload = frameBuffer.subarray(3);

  const frame: Frame = {
    length: frameLength,
    version,
    type,
    flags,
    payload,
  };

  // Return frame and remaining buffer
  const remaining = buffer.subarray(totalSize);

  return { frame, remaining };
}
