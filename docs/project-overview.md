# Project Overview

This project is a real-time networking server built in Node.js to deeply understand how Node works at the systems level, not just at the framework level.

The goal is to learn by building:

- Streams and backpressure handling
- Buffers and binary data handling
- Event-driven architecture using EventEmitters
- Character sets and encodings (UTF-8, binary payloads)
- Low-level networking using the core `net` and `http` modules

The system is designed as a message relay engine, the kind of core infrastructure that sits underneath chat apps, multiplayer games, collaborative tools, and live dashboards.

This is intentionally **not** a UI-focused project. It is protocol-first and systems-oriented.

---

# Design Principles

These principles guide every decision in this project:

1. TCP is a byte stream, not message-based
2. Messages must be explicitly framed
3. Parsing must support partial and combined packets
4. The protocol must be forward-compatible
5. Debuggability is more important than cleverness

---

# High-Level Architecture

- Clients connect via raw TCP sockets (initial implementation)
- Each connection is treated as a Duplex stream
- Incoming data is processed incrementally using Buffers
- Low-level socket events are translated into higher-level semantic events
- Message routing is driven by an internal event system

Future layers (HTTP, WebSocket, TLS) will be added without changing the core protocol.

---

# Protocol Overview

The protocol is a binary, frame-based protocol designed for reliability and extensibility.

Each message sent over the wire is a **frame** with the following structure:

```
| length | version | type | flags | payload |
```

All numeric fields use Big Endian encoding (network byte order).

---

# Frame Structure

## Header (Fixed Size: 7 bytes)

### 1. Length (4 bytes – UInt32BE)

- Total length of the frame including header and payload
- Used to determine frame boundaries
- Maximum theoretical size: ~4GB

### 2. Version (1 byte – UInt8)

- Protocol version
- Initial version: `1`
- Allows future protocol changes without breaking existing clients

### 3. Message Type (1 byte – UInt8)

Defines the semantic intent of the message.

Initial message types:

- `0x01` – HELLO
- `0x02` – JOIN_ROOM
- `0x03` – LEAVE_ROOM
- `0x04` – MESSAGE
- `0x05` – HEARTBEAT
- `0x06` – ERROR

### 4. Flags (1 byte – Bitmask)

Flags modify how the payload should be interpreted.

Initial flag definitions:

- `0b00000001` – Payload is UTF-8 JSON
- `0b00000010` – Payload is binary
- `0b00000100` – Payload is compressed (reserved)

Unused bits are reserved for future use.

---

## Payload (Variable Length)

- Raw bytes
- Interpretation depends on message type and flags
- May be empty (e.g. HEARTBEAT messages)

Payload length is calculated as:

```
payloadLength = frameLength - headerLength
```

---

# Example Message: JOIN_ROOM

Intent:
A client requests to join a room named `physics-nerds`.

Header:

- Version: `1`
- Type: `0x02` (JOIN_ROOM)
- Flags: `0b00000001` (UTF-8 JSON)

Payload (UTF-8 JSON):

```json
{
  "room": "physics-nerds"
}
```

The JSON is encoded to a Buffer, the header is prepended, and the frame is sent.

---

# Parsing Strategy

Each client connection maintains its own receive buffer:

- `recvBuffer: Buffer`

On each `data` event from the socket:

1. Append the incoming chunk to `recvBuffer`
2. While `recvBuffer.length >= HEADER_SIZE`:

   - Read the frame length
   - If `recvBuffer.length < frameLength`, stop and wait for more data
   - Otherwise:

     - Slice the full frame
     - Emit a higher-level `frame` or `message` event
     - Remove the processed bytes from `recvBuffer`

3. Repeat until no complete frames remain

This logic handles:

- Fragmented packets
- Multiple frames in a single chunk
- Arbitrary network boundaries

---

# Error Handling Rules

The server must fail fast on protocol violations.

Error conditions include:

- Invalid or excessively large frame length
- Unsupported protocol version
- Unknown message type
- Invalid payload encoding

On error:

1. Send an ERROR frame to the client
2. Close the connection

Corrupted streams are not recoverable.

---

# Heartbeats

- Message Type: `HEARTBEAT`
- Payload: empty

Used to:

- Detect dead or half-open connections
- Clean up inactive clients
- Maintain room integrity

Heartbeat frequency may be enforced by the server.

---

# Connection State Machine

The Connection follows a strict internal state machine. This is the authoritative lifecycle for every client connection.

```
           +------+
           | INIT |
           +------+
               |
               | setup complete
               v
           +------+
           | OPEN |
           +------+
            |    ^
            |    |
 backpressure   | drain
 detected       |
            v    |
        +-----------+
        | DRAINING  |
        +-----------+
            |
            | fatal error / explicit close
            v
         +---------+
         | CLOSING |
         +---------+
               |
               | socket closed
               v
          +--------+
          | CLOSED |
          +--------+
```

### State Notes

- `INIT` exists to keep construction and listener wiring deterministic.
- `OPEN` is the normal operating state where frames are parsed and sent.
- `DRAINING` represents outbound backpressure; inbound data may still flow.
- `CLOSING` is a one-way transition to shutdown; no new work is accepted.
- `CLOSED` is terminal. No events or writes occur beyond this point.

Only the `OPEN ↔ DRAINING` transition is reversible. All other transitions are one-way.

---
