# Relay Architecture

## Overview

Relay is a **systems-level learning project** focused on understanding TCP networking, binary protocols, and Node.js internals. It implements a production-grade message relay engine with clean separation of concerns across packages.

This document explains the system design, data flow, and architectural decisions.

## Design Philosophy

### Core Principles

1. **Separation of Concerns**

   - Protocol logic never touches sockets
   - Transport logic never interprets frames
   - Business logic (rooms) is independent of networking

2. **Explicit Over Implicit**

   - State machines enforce valid transitions
   - Errors fail fast with clear messages
   - No magic: every operation is traceable

3. **Production-Grade Quality**

   - Handle backpressure correctly
   - No memory leaks on abrupt disconnects
   - Debuggable with verbose logging

4. **Learning-Focused**
   - Use Node.js core modules (`net`, `events`, `buffer`)
   - No frameworks (Express, Socket.IO)
   - Understand TCP as byte streams, not message streams

### What This Is NOT

- **Not a framework** - No plugin system, no abstractions for "any protocol"
- **Not feature-complete** - No auth, persistence, or encryption
- **Not production-ready** - Missing rate limiting, monitoring, TLS

This is **infrastructure to learn from**, not a product to deploy.

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Relay Server                           │
│                                                             │
│  Application Layer                                          │
│  ┌───────────────┐      ┌──────────────┐     ┌────────────┐ │
│  │   TCP Server  │─────>│ Connection   │────>│    Room    │ │
│  │  (net module) │      │   Manager    │     │  Manager   │ │
│  └───────┬───────┘      └──────┬───────┘     └──────┬─────┘ │
│          │                     │                    │       │
│          └─────────────────────┼────────────────────┘       │
│                                │                            │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                │                            │
│  Package Layer                 v                            │
│                         ┌─────────────┐                     │
│                         │  Transport  │                     │
│                         │   Package   │                     │
│                         │ (Connection)│                     │
│                         └──────┬──────┘                     │
│                                │                            │
│                                v                            │
│                         ┌─────────────┐                     │
│                         │  Protocol   │                     │
│                         │   Package   │                     │
│                         │(encodeFrame)│                     │
│                         └─────────────┘                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Package Structure

```
relay/
├── apps/
│   ├── server/          # Runnable TCP server
│   └── client/          # CLI demo client
├── packages/
│   ├── protocol/        # Pure protocol logic (frame encoding/decoding)
│   └── transport/       # Socket abstractions (Connection, backpressure)
└── scripts/             # Stress testing tools
```

### Layer Responsibilities

| Layer         | Responsibility                     | Examples                      |
| ------------- | ---------------------------------- | ----------------------------- |
| **App**       | Wiring, configuration, entry point | server.ts, cli.ts             |
| **Domain**    | Business logic, room management    | Room, RoomManager, handlers   |
| **Transport** | TCP connection management          | Connection, ConnectionManager |
| **Protocol**  | Binary frame encoding/decoding     | encodeFrame, decodeFrame      |

## Data Flow

### Inbound Message Flow (Client → Server)

```
1. TCP Socket receives bytes
   │
   ├─> socket.on('data', chunk)
   │
2. Connection accumulates bytes in recvBuffer
   │
   ├─> recvBuffer = Buffer.concat([recvBuffer, chunk])
   │
3. Connection extracts complete frames
   │
   ├─> while (extractFrame(recvBuffer)) { ... }
   │
4. Connection decodes frame payload
   │
   ├─> decodeFrame(frameBuffer) → ParsedFrame
   │
5. Connection emits frame event
   │
   ├─> this.emit('frame', parsedFrame)
   │
6. Server dispatches to handler
   │
   ├─> switch (frame.type) { case MESSAGE: handleMessage() }
   │
7. Handler updates domain model
   │
   ├─> room.broadcast(message)
   │
8. Room emits broadcast event
   │
   ├─> this.emit('broadcast', message)
   │
9. RoomManager sends to all members
   │
   └─> connection.sendFrame(MESSAGE, payload)
```

### Outbound Message Flow (Server → Client)

```
1. Application calls connection.sendFrame()
   │
   ├─> connection.sendFrame(MessageType.MESSAGE, payload)
   │
2. Connection encodes frame
   │
   ├─> encodeFrame(type, payload) → { buffer }
   │
3. Connection writes to socket
   │
   ├─> socket.write(buffer)
   │
4. Handle backpressure if write returns false
   │
   ├─> if (!socket.write(...)) { transition to DRAINING }
   │
5. Wait for drain event
   │
   ├─> socket.once('drain', () => transition to OPEN)
   │
6. TCP sends bytes over network
   │
   └─> Client receives data
```

## Package Details

### 1. Protocol Package (`packages/protocol/`)

**Purpose:** Pure protocol logic, no I/O dependencies.

**Exports:**

- `encodeFrame(type, payload)` - Serialize frame to Buffer
- `decodeFrame(buffer)` - Deserialize Buffer to ParsedFrame
- `extractFrame(buffer)` - Incremental parser (returns frame + remaining bytes)
- Constants: `MessageType`, `FLAG_UTF8_JSON`, `FLAG_BINARY`, `HEADER_SIZE`
- Errors: `ProtocolError`

**Key Design:**

- **No socket imports** - Can be tested in isolation
- **Big Endian** - All numeric fields use `readUInt32BE()`, `writeUInt32BE()`
- **Incremental parsing** - `extractFrame()` handles fragmented frames

**Example:**

```typescript
import { encodeFrame, MessageType } from "@relay/protocol";

const frame = encodeFrame(MessageType.HELLO, { userId: "user-123" });
// → { buffer: Buffer<51 bytes> }

socket.write(frame.buffer);
```

---

### 2. Transport Package (`packages/transport/`)

**Purpose:** Socket abstractions, connection lifecycle, backpressure handling.

**Exports:**

- `Connection` - Manages single TCP socket with state machine
- `ConnectionManager` - Tracks all active connections

**Key Design:**

- **State machine** - Connection goes through `INIT → OPEN ⟷ DRAINING → CLOSING → CLOSED`
- **Backpressure handling** - Transitions to DRAINING when `socket.write()` returns false
- **Event emitters** - Connection emits `frame`, `close`, `error`, `stateChange`

**State Machine:**

```
     INIT
      │
      v
     OPEN <──────┐
      │          │
      │ (backpressure)
      v          │
   DRAINING ─────┘
      │   (drain event)
      │
      v
   CLOSING
      │
      v
    CLOSED
```

**Example:**

```typescript
import { Connection } from "@relay/transport";

const connection = new Connection(socket, "conn-1");

connection.on("frame", (frame) => {
  console.log("Received:", frame.type);
});

connection.on("stateChange", (oldState, newState) => {
  console.log(`State: ${oldState} → ${newState}`);
});

connection.sendFrame(MessageType.HELLO, { userId: "server" });
```

---

### 3. Server App (`apps/server/`)

**Purpose:** Runnable TCP server, wires packages together.

**Structure:**

```
apps/server/src/
├── index.ts                  # Entry point, signal handling
├── server.ts                 # TCP server setup
├── config.ts                 # Configuration
├── handlers/                 # Message type handlers
│   ├── hello.ts              # Handle HELLO frames
│   ├── joinRoom.ts           # Handle JOIN_ROOM frames
│   ├── leaveRoom.ts          # Handle LEAVE_ROOM frames
│   └── message.ts            # Handle MESSAGE frames
├── rooms/
│   ├── room.ts               # Room domain model
│   └── roomManager.ts        # Manages all rooms
└── observability/
    ├── logger.ts             # Structured logging
    └── metrics.ts            # Performance tracking
```

**Startup Sequence:**

```
1. Load configuration (port, host, debug mode)
2. Initialize logger and metrics
3. Create RoomManager
4. Create TcpServer with connection handler
5. For each new connection:
   a. Create Connection wrapper
   b. Wire frame handlers
   c. Start receiving frames
6. Listen on port
7. Log startup message
```

**Shutdown Sequence:**

```
1. Receive SIGINT/SIGTERM
2. Log shutdown message
3. Close TCP server (stop accepting new connections)
4. Close all active connections gracefully
5. Print final metrics
6. Exit process
```

---

### 5. Client App (`apps/client/`)

**Purpose:** CLI tool for testing server, demo purposes.

**Commands:**

- `relay-client connect <host:port>` - Connect to server
- `relay-client join <room>` - Join a room
- `relay-client send <room> <message>` - Send message to room
- `relay-client heartbeat` - Send heartbeat ping

**Example Session:**

```bash
$ relay-client connect localhost:4000
✓ Connected to localhost:4000

$ relay-client join general
✓ Joined room 'general'

$ relay-client send general "Hello, world!"
✓ Message sent

[Received] general: Hello, world!
```

## Key Components

### Connection Class

**File:** `packages/transport/src/connection/connection.ts`

**Responsibilities:**

1. Wrap raw TCP socket
2. Parse incoming frames incrementally
3. Encode and send outgoing frames
4. Manage connection state machine
5. Handle backpressure

**State Machine Implementation:**

```typescript
class Connection extends EventEmitter {
  private state: ConnectionState = ConnectionState.INIT;
  private recvBuffer: Buffer = Buffer.alloc(0);

  private onData(chunk: Buffer): void {
    // Only process data in OPEN or DRAINING
    if (
      this.state !== ConnectionState.OPEN &&
      this.state !== ConnectionState.DRAINING
    ) {
      return;
    }

    // Accumulate bytes
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);

    // Extract complete frames
    while (this.recvBuffer.length > 0) {
      const result = extractFrame(this.recvBuffer);
      if (!result) break; // Need more data

      const parsed = decodeFrame(result.frame);
      this.emit("frame", parsed);

      this.recvBuffer = result.remaining;
    }
  }

  public sendFrame(type: MessageType, payload: unknown): void {
    if (this.state !== ConnectionState.OPEN) {
      throw new Error("Cannot send frame: connection not open");
    }

    const encoded = encodeFrame(type, payload);
    const flushed = this.socket.write(encoded.buffer);

    // Handle backpressure
    if (!flushed) {
      this.transitionTo(ConnectionState.DRAINING);
    }
  }
}
```

**Invariants:**

- Frame events emitted only in OPEN or DRAINING states
- Connection emits `close` exactly once
- State transitions are one-way except OPEN ⟷ DRAINING

---

### Room Class

**File:** `apps/server/src/rooms/room.ts`

**Responsibilities:**

1. Track members (connections) in a room
2. Broadcast messages to all members
3. Emit events for room lifecycle (created, deleted, member join/leave)

**Key Methods:**

```typescript
class Room extends EventEmitter {
  private members = new Map<string, Connection>();

  public addMember(connection: Connection): void {
    this.members.set(connection.id, connection);
    logger.info(
      `[${connection.id}] Joined room '${this.name}' (${this.members.size} members)`
    );
  }

  public broadcast(message: unknown, excludeId?: string): void {
    for (const [connId, connection] of this.members) {
      if (connId === excludeId) continue;

      try {
        connection.sendFrame(MessageType.MESSAGE, message);
      } catch (err) {
        logger.error(`Failed to broadcast to ${connId}:`, err);
      }
    }
  }

  public removeMember(connectionId: string): void {
    this.members.delete(connectionId);
    logger.info(
      `[${connectionId}] Left room '${this.name}' (${this.members.size} members remaining)`
    );

    // Auto-cleanup empty rooms
    if (this.members.size === 0) {
      this.emit("empty");
    }
  }
}
```

**Design Notes:**

- Rooms are created on-demand (first JOIN_ROOM)
- Rooms are deleted when last member leaves
- Broadcast is **synchronous** - all members receive message immediately
- Failed broadcasts don't stop other deliveries (isolated error handling)

---

### RoomManager Class

**File:** `apps/server/src/rooms/roomManager.ts`

**Responsibilities:**

1. Create/delete rooms
2. Track all active rooms
3. Handle member join/leave
4. Coordinate room cleanup

**Key Methods:**

```typescript
class RoomManager {
  private rooms = new Map<string, Room>();

  public joinRoom(roomName: string, connection: Connection): void {
    let room = this.rooms.get(roomName);

    if (!room) {
      room = new Room(roomName);
      this.rooms.set(roomName, room);
      logger.info(`Room '${roomName}' created`);

      // Auto-delete when empty
      room.once("empty", () => {
        this.rooms.delete(roomName);
        logger.info(`Room '${roomName}' deleted (empty)`);
      });
    }

    room.addMember(connection);
  }

  public leaveRoom(roomName: string, connectionId: string): void {
    const room = this.rooms.get(roomName);
    if (room) {
      room.removeMember(connectionId);
    }
  }

  public leaveAllRooms(connectionId: string): void {
    for (const room of this.rooms.values()) {
      if (room.hasMember(connectionId)) {
        room.removeMember(connectionId);
      }
    }
  }
}
```

**Cleanup Strategy:**

- Rooms emit `empty` event when last member leaves
- RoomManager listens once and deletes room
- On connection close, server calls `leaveAllRooms(connId)` to cleanup

---

### Message Handlers

**Pattern:** Each message type has a dedicated handler function.

**File:** `apps/server/src/handlers/message.ts`

**Example:**

```typescript
export function handleMessage(
  connection: Connection,
  frame: ParsedFrame,
  roomManager: RoomManager
): void {
  const { room, content } = frame.payload as { room: string; content: string };

  // Validate client is in room
  const roomObj = roomManager.getRoom(room);
  if (!roomObj || !roomObj.hasMember(connection.id)) {
    connection.sendFrame(MessageType.ERROR, {
      code: "NOT_IN_ROOM",
      message: `You are not in room '${room}'`,
    });
    return;
  }

  // Broadcast to all room members (including sender)
  roomObj.broadcast({
    room,
    content,
    timestamp: Date.now(),
  });
}
```

**Handler Responsibilities:**

1. Validate frame payload
2. Check preconditions (e.g., client is in room)
3. Update domain model (e.g., call room.broadcast())
4. Send responses (confirmation, error)

## Observability

### Logger

**File:** `apps/server/src/observability/logger.ts`

**Features:**

- Structured logging (timestamp, level, message, context)
- Debug mode via `RELAY_DEBUG=1` environment variable
- Specialized log methods: `connection()`, `frame()`, `stateTransition()`

**Log Levels:**

```typescript
enum LogLevel {
  DEBUG = 0, // Verbose: frame bytes, buffer states
  INFO = 1, // Business events: room created, client joined
  WARN = 2, // Unexpected but recoverable: failed broadcast
  ERROR = 3, // Failures: protocol errors, disconnects
}
```

**Example Output:**

```
[2025-12-18T14:01:35.884Z] [DEBUG] [conn-1] ← Frame {"type":"HELLO","version":1,"flags":"0b00000001","payloadSize":"44B"}
[2025-12-18T14:01:36.142Z] [INFO] Room 'test-room' created
[2025-12-18T14:01:36.143Z] [INFO] [conn-1] Joined room 'test-room' (1 members)
```

---

### Metrics

**File:** `apps/server/src/observability/metrics.ts`

**Tracked Metrics:**

- `connectionCount` - Active connections
- `roomCount` - Active rooms
- `totalBytesSent` - Cumulative bytes sent
- `totalBytesReceived` - Cumulative bytes received
- `messagesProcessed` - Frames parsed
- `startTime` - Server start timestamp

**Display:**

```
Server Metrics:
  Uptime:              26s
  Active Connections:  0
  Active Rooms:        0
  Bytes Sent:          165B
  Bytes Received:      471B
  Messages Processed:  8
  Messages/sec:        0.31
```

**Usage:**

```typescript
import { metrics } from "./observability/metrics";

metrics.incrementConnections();
metrics.addBytesSent(1024);
metrics.incrementMessages();
```

## Error Handling

### Error Categories

1. **Protocol Errors** - Invalid frames, unsupported versions

   - Action: Send ERROR frame, close connection
   - Example: Frame length > 10MB

2. **Application Errors** - Business logic violations

   - Action: Send ERROR frame, keep connection open (or close)
   - Example: MESSAGE to room not joined

3. **Network Errors** - Socket errors, timeouts
   - Action: Log error, close connection
   - Example: `ECONNRESET`, `ETIMEDOUT`

### Error Handling Pattern

```typescript
try {
  // Parse frame
  const frame = decodeFrame(buffer);

  // Validate
  if (frame.version !== PROTOCOL_VERSION) {
    throw new ProtocolError("Unsupported version");
  }

  // Process
  handleFrame(frame);
} catch (err) {
  if (err instanceof ProtocolError) {
    // Send ERROR frame
    connection.sendFrame(MessageType.ERROR, {
      code: "INVALID_FRAME",
      message: err.message,
    });
    connection.close();
  } else {
    // Log unexpected error
    logger.error("Unexpected error:", err);
    connection.close();
  }
}
```

### Graceful Shutdown

**On SIGINT/SIGTERM:**

1. Stop accepting new connections (`server.close()`)
2. Close all active connections gracefully
3. Wait for connections to finish (timeout: 5s)
4. Print final metrics
5. Exit with code 0

**Implementation:**

```typescript
process.on("SIGINT", async () => {
  logger.info("Shutting down Relay server...");

  // Stop accepting new connections
  server.close();

  // Close all connections
  for (const connection of connectionManager.getAll()) {
    connection.close();
  }

  // Wait for cleanup
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Print metrics
  metrics.print();

  process.exit(0);
});
```

## Performance Considerations

### Backpressure Handling

**Problem:** Server sends data faster than client can read.

**Solution:**

1. `socket.write()` returns `false` when buffer is full
2. Connection transitions to `DRAINING` state
3. Connection waits for `drain` event
4. Connection transitions back to `OPEN` state

**Code:**

```typescript
public sendFrame(type: MessageType, payload: unknown): void {
  const encoded = encodeFrame(type, payload);
  const flushed = this.socket.write(encoded.buffer);

  if (!flushed) {
    this.transitionTo(ConnectionState.DRAINING);
    this.socket.once('drain', () => {
      this.transitionTo(ConnectionState.OPEN);
    });
  }
}
```

**Why This Matters:**

- Without backpressure handling, server buffers grow unbounded
- Memory exhaustion on slow clients
- Graceful degradation: slow clients don't affect fast clients

---

### Buffer Management

**Problem:** Incremental frame parsing requires accumulating bytes.

**Approach:**

1. Maintain `recvBuffer: Buffer` per connection
2. Concatenate incoming chunks: `Buffer.concat([recvBuffer, chunk])`
3. Extract complete frames
4. Update `recvBuffer` to remaining bytes

**Memory Efficiency:**

- Buffers are released as frames are processed
- No unbounded growth (frames have max size 10MB)
- Use `Buffer.subarray()` instead of `Buffer.slice()` (no copy)

**Code:**

```typescript
private onData(chunk: Buffer): void {
  this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);

  while (this.recvBuffer.length > 0) {
    const result = extractFrame(this.recvBuffer);
    if (!result) break;

    // Process frame...

    // Update buffer (subarray is zero-copy)
    this.recvBuffer = result.remaining;
  }
}
```

---

### Broadcast Amplification

**Phenomenon:** One MESSAGE frame triggers N frames sent (N = room size).

**Example:**

- 100 clients in one room
- 1 MESSAGE frame received
- Server sends 100 MESSAGE frames (one per client)
- **100x amplification**

**Observed in Load Test:**

- 100 clients sent 4,900 messages
- Each message broadcast to 33-34 clients (3 rooms)
- Server sent ~160,000 frames
- **48x amplification** (due to room distribution)

**Mitigation Strategies:**

1. **Rate limiting** - Max messages per client per second
2. **Room size limits** - Max 100 members per room
3. **Backpressure** - Slow clients don't block fast clients
4. **Async broadcasting** - Use worker threads for large rooms (future)

---

### Memory Leaks Prevention

**Potential Leaks:**

1. Event listeners not removed on disconnect
2. Buffers not released after frame processing
3. Rooms not deleted when empty
4. Timers not cleared on close

**Prevention:**

```typescript
// Always clean up listeners
connection.on("close", () => {
  connection.removeAllListeners();
});

// Auto-delete empty rooms
room.once("empty", () => {
  this.rooms.delete(roomName);
});

// Clear timers on close
clearInterval(heartbeatInterval);

// Release buffers after processing
this.recvBuffer = result.remaining; // Update reference
```

**Validation:**

- Run chaos test: 20 clients with random disconnects
- Monitor memory usage: should stabilize, not grow
- Check room count: should return to 0 after all clients disconnect

## Testing Strategy

### 1. Unit Tests (Future)

**Protocol Package:**

- Frame encoding/decoding roundtrips
- Invalid frame handling (bad length, unknown type)
- Flag parsing (UTF8_JSON, BINARY)

**Transport Package:**

- Connection state machine transitions
- Backpressure handling
- Frame extraction with fragmentation

**Example:**

```typescript
describe("extractFrame", () => {
  it("should handle byte-by-byte fragmentation", () => {
    let buffer = Buffer.alloc(0);
    const frame = encodeFrame(MessageType.HELLO, { userId: "test" });

    for (let i = 0; i < frame.buffer.length - 1; i++) {
      buffer = Buffer.concat([buffer, frame.buffer.subarray(i, i + 1)]);
      expect(extractFrame(buffer)).toBeNull(); // Incomplete
    }

    buffer = Buffer.concat([
      buffer,
      frame.buffer.subarray(frame.buffer.length - 1),
    ]);
    const result = extractFrame(buffer);
    expect(result).not.toBeNull();
    expect(result!.frame.type).toBe(MessageType.HELLO);
  });
});
```

---

### 2. Integration Tests (Chaos, Load, Fragmentation)

**Chaos Test (`scripts/chaos.ts`):**

- Validates connection state machine stability
- 20 clients with chaotic behavior:
  - Abrupt disconnects (15% probability)
  - Slow consumer pauses (20% probability)
  - Burst message sending
- **Success Criteria:** 0 errors, all rooms cleaned up

**Load Test (`scripts/load.ts`):**

- Validates scalability
- 100 clients sending steady traffic (50 messages each)
- Distributed across 3 rooms
- **Success Criteria:** 100% connection success, 0 errors, stable throughput

**Fragmentation Test (`scripts/fragmentation.ts`):**

- Validates frame parser edge cases
- 5 test scenarios:
  1. Byte-by-byte (send HELLO 1 byte at a time)
  2. Header boundary (split at 7-byte header)
  3. Mid-payload (split payload in half)
  4. Combined frames (3 frames in one write)
  5. Random fragmentation (random 1-10 byte chunks)
- **Success Criteria:** All frames parsed correctly, no disconnects

**Results (2025-12-18):**

- ✅ Chaos: 19 abrupt disconnects handled, 0 errors
- ✅ Load: 100/100 clients, 160 msg/sec, 0 errors
- ✅ Fragmentation: 5/5 tests passed

---

### 3. Manual Testing

**Using CLI Client:**

```bash
# Terminal 1: Start server
npm run server:debug

# Terminal 2: Client 1
npm run client -- connect localhost:4000
npm run client -- join general
npm run client -- send general "Hello from client 1"

# Terminal 3: Client 2
npm run client -- connect localhost:4000
npm run client -- join general
# Should receive "Hello from client 1"

npm run client -- send general "Hello from client 2"
# Both clients receive the message
```

## Future Enhancements

### Near-Term (Production Readiness)

1. **Authentication**

   - Require API key in HELLO frame
   - Validate key against database or JWT

2. **Rate Limiting**

   - Max 10 messages/sec per client
   - Use token bucket algorithm

3. **TLS/SSL**

   - Wrap TCP in `tls.createServer()`
   - Require valid certificates

4. **Monitoring**
   - Export metrics to Prometheus
   - Structured logs to Elasticsearch

### Mid-Term (Features)

1. **Presence**

   - Track online/offline status
   - Broadcast presence changes to room

2. **Message History**

   - Store last 100 messages per room
   - Send history on JOIN_ROOM

3. **Direct Messages**

   - Send message to specific user (not room)
   - Requires user-to-connection mapping

4. **Room Metadata**
   - Room descriptions, creation time
   - List active rooms (`LIST_ROOMS` message type)

### Long-Term (Scalability)

1. **Horizontal Scaling**

   - Multiple server instances
   - Redis pub/sub for cross-server broadcasts
   - Sticky sessions or connection routing

2. **WebSocket Support**

   - HTTP server alongside TCP server
   - Translate WebSocket frames to Relay protocol

3. **Compression**

   - Gzip/Brotli for large payloads
   - Add `FLAG_COMPRESSED` bit

4. **Reliable Delivery**
   - Message IDs and ACKs
   - Retry failed deliveries

## Architectural Decisions

### Why Binary Protocol?

**Alternatives:**

- JSON-over-TCP (newline-delimited)
- MessagePack
- Protobuf

**Decision:** Custom binary protocol

**Rationale:**

- **Learning goal:** Understand binary encoding, endianness, framing
- **Efficiency:** No JSON parsing overhead, compact representation
- **Control:** Full control over wire format, easier to debug
- **Simplicity:** No external dependencies (protobuf compiler, etc.)

---

### Why Length-Prefixed Frames?

**Alternatives:**

- Delimiter-based (e.g., `\n` for JSON lines)
- Fixed-size frames
- No framing (assume one write = one frame)

**Decision:** Length-prefixed frames

**Rationale:**

- **TCP reality:** Byte stream, not message stream
- **Efficiency:** Know exactly when frame is complete (no scanning for delimiter)
- **Binary-safe:** Payloads can contain any bytes (including newlines)
- **Standard:** Used by HTTP/2, WebSocket, most binary protocols

---

### Why EventEmitter Pattern?

**Alternatives:**

- Callbacks
- Promises/async-await
- RxJS Observables

**Decision:** Node.js EventEmitter

**Rationale:**

- **Native to Node.js:** No dependencies
- **Suitable for streams:** TCP sockets are EventEmitters
- **Decoupling:** Listeners don't know about each other
- **Learning goal:** Understand event-driven architecture

---

### Why No Database?

**Decision:** In-memory only (no persistence)

**Rationale:**

- **Learning focus:** TCP networking, not database design
- **Simplicity:** No setup, no migrations, no ORM
- **Performance:** No I/O bottleneck
- **Scope:** This is infrastructure, not an application

**Tradeoff:** Messages lost on server restart, no message history.

---

### Why Monorepo?

**Alternatives:**

- Multi-repo (separate repos for protocol, transport, server)
- Single package (everything in one directory)

**Decision:** Monorepo with separate packages

**Rationale:**

- **Separation of concerns:** Clear boundaries between layers
- **Reusability:** Protocol package can be used by other projects
- **Testability:** Packages can be tested independently
- **Learning goal:** Understand modular design

## Conclusion

Relay is a **learning project** that demonstrates production-grade systems design:

✅ **Core Concepts Learned:**

- TCP as byte streams
- Binary protocol design
- Frame parsing with fragmentation
- Connection state machines
- Backpressure handling
- Event-driven architecture

✅ **Quality Demonstrated:**

- All stress tests passing
- Clean package separation
- Observable with debug mode
- Graceful error handling
- Memory leak prevention

✅ **Next Steps:**

- Add authentication and TLS for production use
- Implement WebSocket bridge for browser clients
- Scale horizontally with Redis pub/sub
- Add comprehensive unit test suite

**This architecture is ready to extend, but complete for its learning goals.**
