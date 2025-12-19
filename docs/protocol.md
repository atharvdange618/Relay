# Relay Protocol Specification

## Overview

Relay uses a binary frame-based protocol over TCP for efficient message transmission. This document specifies the wire format, message types, and protocol behavior.

## Design Principles

1. **Binary over text** - Efficient encoding, no parsing overhead
2. **Length-prefixed frames** - TCP is a byte stream; explicit framing prevents message boundaries ambiguity
3. **Big Endian (network byte order)** - Standard for network protocols
4. **Forward compatibility** - Version field and reserved flag bits allow future extensions
5. **Type safety** - Explicit message type field with validation

## Frame Structure

Every message is encoded as a frame with this structure:

```
┌─────────────┬─────────┬──────┬───────┬──────────────────┐
│ Length (4B) │ Ver(1B) │ Type │ Flags │ Payload (var)    │
│   UInt32BE  │  UInt8  │ (1B) │ (1B)  │                  │
└─────────────┴─────────┴──────┴───────┴──────────────────┘
 \___________________________________________________________/
                    Total frame size
```

### Field Breakdown

| Field   | Size     | Type     | Description                                                |
| ------- | -------- | -------- | ---------------------------------------------------------- |
| Length  | 4 bytes  | UInt32BE | Size of remaining frame (version + type + flags + payload) |
| Version | 1 byte   | UInt8    | Protocol version (currently `1`)                           |
| Type    | 1 byte   | UInt8    | Message type (see Message Types below)                     |
| Flags   | 1 byte   | UInt8    | Bitfield for payload encoding and options                  |
| Payload | Variable | Buffer   | Message-specific data                                      |

**Important:** The `Length` field does NOT include itself (the 4 bytes). It represents the size of everything that follows.

### Why This Structure?

TCP is a **byte stream**, not a message stream. Data arrives in arbitrary chunks:

- One write might arrive as multiple reads
- Multiple writes might arrive in one read
- Frames can be split at any byte boundary

The length prefix solves this: receivers accumulate bytes until they have `4 + length` bytes, then extract one complete frame.

## Parsing Algorithm

```typescript
let recvBuffer = Buffer.alloc(0);

socket.on("data", (chunk) => {
  // Accumulate incoming bytes
  recvBuffer = Buffer.concat([recvBuffer, chunk]);

  // Try to extract frames
  while (recvBuffer.length >= 4) {
    const frameLength = recvBuffer.readUInt32BE(0);
    const totalSize = 4 + frameLength;

    // Wait for complete frame
    if (recvBuffer.length < totalSize) break;

    // Extract frame
    const frameBuffer = recvBuffer.subarray(4, totalSize);
    const version = frameBuffer.readUInt8(0);
    const type = frameBuffer.readUInt8(1);
    const flags = frameBuffer.readUInt8(2);
    const payload = frameBuffer.subarray(3);

    // Process frame...

    // Remove processed frame from buffer
    recvBuffer = recvBuffer.subarray(totalSize);
  }
});
```

## Message Types

| Type | Value | Name       | Direction       | Description                   |
| ---- | ----- | ---------- | --------------- | ----------------------------- |
| 0x01 | 1     | HELLO      | Client → Server | Initial handshake             |
| 0x02 | 2     | JOIN_ROOM  | Client → Server | Join a named room             |
| 0x03 | 3     | LEAVE_ROOM | Client → Server | Leave a room                  |
| 0x04 | 4     | MESSAGE    | Bidirectional   | Chat message in room          |
| 0x05 | 5     | HEARTBEAT  | Bidirectional   | Keep-alive ping/pong          |
| 0x06 | 6     | ERROR      | Server → Client | Protocol or application error |

## Flags

Flags are a bitfield (8 bits) indicating payload encoding and options:

| Bit | Mask       | Name      | Description                         |
| --- | ---------- | --------- | ----------------------------------- |
| 0   | 0b00000001 | UTF8_JSON | Payload is UTF-8 encoded JSON       |
| 1   | 0b00000010 | BINARY    | Payload is raw binary data          |
| 2-7 | -          | Reserved  | Reserved for future use (must be 0) |

**Default:** If payload is a JavaScript object, `UTF8_JSON` flag is set automatically.

## Message Specifications

### 1. HELLO (0x01)

**Purpose:** Client introduces itself to server.

**Direction:** Client → Server

**Payload (JSON):**

```json
{
  "userId": "user-123",
  "clientVersion": "1.0.0"
}
```

**Server Response:** HELLO acknowledgment with same structure.

**Example Frame (hex):**

```
Length:  00 00 00 2F    (47 bytes)
Version: 01             (protocol v1)
Type:    01             (HELLO)
Flags:   01             (UTF8_JSON)
Payload: {"userId":"user-123","clientVersion":"1.0.0"}
```

**Total frame size:** 4 (length) + 47 (frame content) = 51 bytes

---

### 2. JOIN_ROOM (0x02)

**Purpose:** Join a named room to participate in group chat.

**Direction:** Client → Server

**Payload (JSON):**

```json
{
  "room": "general"
}
```

**Behavior:**

- Room is created if it doesn't exist
- Client receives all subsequent MESSAGE frames sent to this room
- Client can be in multiple rooms simultaneously

**Server Response:** JOIN_ROOM confirmation with same payload.

**Example:**

```
Length:  00 00 00 14    (20 bytes)
Version: 01
Type:    02             (JOIN_ROOM)
Flags:   01
Payload: {"room":"general"}
```

---

### 3. LEAVE_ROOM (0x03)

**Purpose:** Leave a room.

**Direction:** Client → Server

**Payload (JSON):**

```json
{
  "room": "general"
}
```

**Behavior:**

- Client stops receiving MESSAGE frames from this room
- If room becomes empty, server deletes it
- Safe to call even if not in room (idempotent)

**Server Response:** LEAVE_ROOM confirmation with same payload.

---

### 4. MESSAGE (0x04)

**Purpose:** Send a message to all members of a room.

**Direction:** Bidirectional

- Client → Server: Send message to room
- Server → Client: Broadcast message from another client

**Payload (JSON):**

```json
{
  "room": "general",
  "content": "Hello, world!",
  "timestamp": 1703001234567
}
```

**Behavior:**

- Server broadcasts to **all** room members (including sender)
- Messages are **not** stored; only delivered to currently connected clients
- If client isn't in specified room, server sends ERROR

**Example:**

```
Length:  00 00 00 4A    (74 bytes)
Version: 01
Type:    04             (MESSAGE)
Flags:   01
Payload: {"room":"general","content":"Hello, world!","timestamp":1703001234567}
```

**Broadcast amplification:** If a room has N members, server sends N frames (one per client).

---

### 5. HEARTBEAT (0x05)

**Purpose:** Keep connection alive and detect dead peers.

**Direction:** Bidirectional

- Client → Server: Ping
- Server → Client: Pong (echoes back)

**Payload:** Empty (0 bytes) or arbitrary data to echo back.

**Behavior:**

- Client should send HEARTBEAT every 30 seconds
- Server echoes back immediately
- No response after 60 seconds = assume connection dead

**Example (empty payload):**

```
Length:  00 00 00 03    (3 bytes: version + type + flags)
Version: 01
Type:    05             (HEARTBEAT)
Flags:   00             (no payload)
Payload: (empty)
```

---

### 6. ERROR (0x06)

**Purpose:** Notify client of protocol violation or application error.

**Direction:** Server → Client

**Payload (JSON):**

```json
{
  "code": "INVALID_FRAME",
  "message": "Frame length exceeds maximum (10MB)"
}
```

**Error Codes:**

| Code                 | Description                                  |
| -------------------- | -------------------------------------------- |
| INVALID_FRAME        | Malformed frame (bad length, invalid type)   |
| UNSUPPORTED_VERSION  | Protocol version not supported               |
| PARSE_ERROR          | JSON payload invalid when UTF8_JSON flag set |
| NOT_IN_ROOM          | Attempted MESSAGE to room not joined         |
| UNKNOWN_MESSAGE_TYPE | Unrecognized message type                    |

**Behavior:**

- Server sends ERROR frame, then **closes connection**
- Clients should log error and attempt reconnection

**Example:**

```
Length:  00 00 00 47    (71 bytes)
Type:    06             (ERROR)
Flags:   01
Payload: {"code":"INVALID_FRAME","message":"Frame length exceeds maximum"}
```

## Connection Lifecycle

```
Client                                  Server
  │                                       │
  ├─────── TCP Connect ──────────────────>│
  │                                       │
  ├─────── HELLO ────────────────────────>│
  │<───── HELLO (ack) ────────────────────┤
  │                                       │
  ├─────── JOIN_ROOM("general") ─────────>│
  │<───── JOIN_ROOM (ack) ────────────────┤
  │                                       │
  ├─────── MESSAGE("Hello") ─────────────>│
  │<──── MESSAGE("Hello") [broadcast] ────┤
  │                                       │
  ├─────── HEARTBEAT ────────────────────>│
  │<───── HEARTBEAT (echo) ───────────────┤
  │                                       │
  ├─────── LEAVE_ROOM("general") ────────>│
  │<───── LEAVE_ROOM (ack) ───────────────┤
  │                                       │
  ├─────── TCP Close ────────────────────>│
  │                                       │
```

## Protocol Constraints

### Frame Size Limits

- **Maximum frame size:** 10 MB (10,485,760 bytes)
- Frames larger than this trigger ERROR and connection close
- Prevents memory exhaustion attacks

### Version Compatibility

- **Current version:** 1
- Server rejects frames with `version != 1` (sends ERROR)
- Future versions will maintain backward compatibility where possible

### Message Ordering

- Frames are delivered **in order** (TCP guarantee)
- No message IDs or acknowledgments (at-most-once delivery)
- Clients must handle duplicate broadcasts gracefully

### Concurrency

- Clients can send frames anytime (no request/response pairing)
- Server may send unsolicited frames (broadcasts, errors)
- Frame processing is sequential per connection (no race conditions)

## Error Handling

### Invalid Length

```
If length == 0 or length > 10MB:
  → Send ERROR("INVALID_FRAME")
  → Close connection
```

### Unsupported Version

```
If version != 1:
  → Send ERROR("UNSUPPORTED_VERSION")
  → Close connection
```

### Unknown Message Type

```
If type not in [0x01..0x06]:
  → Send ERROR("UNKNOWN_MESSAGE_TYPE")
  → Close connection
```

### Invalid JSON

```
If UTF8_JSON flag set and payload is not valid JSON:
  → Send ERROR("PARSE_ERROR")
  → Close connection
```

## Wire Format Examples

### Complete Frame Breakdown

**Frame:** JOIN_ROOM for room "test"

**Payload (JSON):**

```json
{ "room": "test" }
```

**Encoding steps:**

1. Serialize payload to UTF-8: `{"room":"test"}` = 15 bytes
2. Calculate frame content length: 1 (version) + 1 (type) + 1 (flags) + 15 (payload) = 18 bytes
3. Set flags: 0b00000001 (UTF8_JSON)
4. Encode frame:

```
Byte offset: 0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21
Hex:        00 00 00 12 01 02 01 7B 22 72 6F 6F 6D 22 3A 22 74 65 73 74 22 7D
Field:      [Length=18] V  T  F  {"room":"test"}
            [         ] e  y  l
                        r  p  a
                        s  e  g
                        i     s
                        o
                        n
```

**Total:** 22 bytes on the wire

## Future Extensions

### Potential New Flags

- **Compression:** `0b00000100` - Payload is gzip/brotli compressed
- **Encryption:** `0b00001000` - Payload is encrypted (end-to-end)
- **Priority:** `0b00010000` - High-priority message (process first)

### Potential New Message Types

- **0x07 PING_ROOM** - Check if room exists without joining
- **0x08 LIST_ROOMS** - Request list of active rooms
- **0x09 PRESENCE** - Announce user online/offline status
- **0x0A ACK** - Explicit acknowledgment for reliable delivery

All extensions will maintain backward compatibility by:

1. Incrementing protocol version
2. Making new features opt-in via flags
3. Older servers ignoring unknown message types gracefully

## Security Considerations

### Current Implementation

- **No authentication** - Anyone can connect
- **No encryption** - Messages sent in plaintext
- **No rate limiting** - Clients can spam messages

### Production Requirements

Before deploying to production, implement:

1. **TLS/SSL** - Wrap TCP in TLS for transport encryption
2. **Authentication** - Require API key or JWT in HELLO
3. **Rate Limiting** - Max messages per second per client
4. **Message Size Limits** - Already enforced (10MB)
5. **Connection Limits** - Max concurrent connections per IP
6. **Validation** - Sanitize room names, content fields

## Implementation Notes

### Language-Specific Considerations

**JavaScript/Node.js:**

- Use `Buffer.allocUnsafe()` for performance (zero-fill not needed)
- Always use `readUInt32BE()` / `writeUInt32BE()` for network byte order
- Handle backpressure: check `socket.write()` return value

**Python:**

- Use `struct.pack('>I', length)` for Big Endian UInt32
- `socket.recv()` may return partial frames; accumulate in buffer

**Go:**

- Use `binary.BigEndian.Uint32()` for parsing
- Buffered I/O with `bufio.Reader` simplifies framing

**Rust:**

- Use `byteorder` crate for endian-safe reads
- Consider `tokio` for async TCP with proper backpressure

## Testing Recommendations

### Unit Tests

- Frame encoding/decoding roundtrips
- Fragmented frame parsing (byte-by-byte, split at random points)
- Invalid frame handling (bad length, unsupported version)

### Integration Tests

- Multiple clients joining same room
- Message broadcast to all room members
- Graceful disconnection and room cleanup

### Stress Tests

- 100+ concurrent clients
- High message rate (1000+ msg/sec)
- Random disconnects (chaos testing)
- Slow consumers (backpressure handling)

## Reference Implementation

See the Relay codebase for a complete implementation:

- **Frame encoding/decoding:** `packages/protocol/src/frame.ts` (`encodeFrame`, `decodeFrame`, `extractFrame`)
- **Incremental parsing:** `packages/transport/src/connection/connection.ts` (Connection class data handler)

## Changelog

### Version 1 (2025-12-18)

- Initial protocol specification
- Message types: HELLO, JOIN_ROOM, LEAVE_ROOM, MESSAGE, HEARTBEAT, ERROR
- Frame format: length-prefixed binary protocol
- Flags: UTF8_JSON, BINARY
