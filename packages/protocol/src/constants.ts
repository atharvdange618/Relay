/**
 * Protocol Constants
 *
 * Defines message types, flags, and protocol parameters.
 */

// Protocol version
export const PROTOCOL_VERSION = 1;

// Frame structure sizes
export const HEADER_SIZE = 7; // length(4) + version(1) + type(1) + flags(1)
export const LENGTH_FIELD_SIZE = 4;
export const MAX_FRAME_SIZE = 10 * 1024 * 1024; // 10MB safety limit

// Message Types (1 byte)
export enum MessageType {
  HELLO = 0x01,
  JOIN_ROOM = 0x02,
  LEAVE_ROOM = 0x03,
  MESSAGE = 0x04,
  HEARTBEAT = 0x05,
  ERROR = 0x06,
}

// Flags (bitmask)
export const FLAG_UTF8_JSON = 0b00000001; // Payload is UTF-8 JSON
export const FLAG_BINARY = 0b00000010; // Payload is binary
export const FLAG_COMPRESSED = 0b00000100; // Payload is compressed (reserved)
