# Relay - AI Coding Agent Instructions

## Project Context

Relay is a **systems-level Node.js learning project** focused on TCP networking, streams, and binary protocols. This is **infrastructure, not an application** - no UI, no auth, no frameworks. The goal is to deeply understand Node.js internals by building a production-grade message relay engine.

**Implementation has not started yet.** The design is fully specified in [project-overview.md](../project-overview.md), [connection.md](../connection.md), [state-machine.md](../state-machine.md), and [outcome.md](../outcome.md).

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Modules**: ES modules (`import`/`export`)
- **Runtime**: Node.js core modules only (`net`, `events`, `buffer`)
- **Testing**: Vitest for unit and integration tests
- **Monorepo**: Apps and packages structure (see [project-structure.md](../project-structure.md))

## Core Architecture

**Binary Frame-Based Protocol:**

```
| length (4B) | version (1B) | type (1B) | flags (1B) | payload (variable) |
```

- All numeric fields use **Big Endian** (network byte order)
- TCP is a byte stream - messages must be explicitly framed
- Each connection maintains a `recvBuffer` for incremental parsing
- Parsing must handle fragmented packets, combined frames, and arbitrary network boundaries

**Message Types** (see [project-overview.md](../project-overview.md#frame-structure)):

- `0x01` HELLO, `0x02` JOIN_ROOM, `0x03` LEAVE_ROOM
- `0x04` MESSAGE, `0x05` HEARTBEAT, `0x06` ERROR

**Flags**: `0b00000001` = UTF-8 JSON, `0b00000010` = binary

## Implementation Principles

1. **Use core Node.js modules only** - `net`, `http`, `events`, `buffer` - no Express, Socket.IO, or frameworks
2. **Treat sockets as Duplex streams** - handle backpressure, drain events, and buffer discipline correctly
3. **Fail fast on protocol violations** - send ERROR frame, close connection, log clearly
4. **Debuggability over cleverness** - explicit state machines, verbose logging in debug mode
5. **Forward compatibility** - version field and reserved flag bits for future protocol evolution
6. **Separation of concerns** - protocol logic never touches sockets; transport logic never interprets frames

## Frame Parsing Pattern

```typescript
// Each connection maintains its own buffer
const HEADER_SIZE = 7;

socket.on("data", (chunk: Buffer) => {
  recvBuffer = Buffer.concat([recvBuffer, chunk]);

  while (recvBuffer.length >= HEADER_SIZE) {
    const frameLength = recvBuffer.readUInt32BE(0);
    if (recvBuffer.length < frameLength) break; // wait for more data

    const frame = recvBuffer.subarray(0, frameLength);
    recvBuffer = recvBuffer.subarray(frameLength);

    processFrame(frame); // extract version, type, flags, payload
  }
});
```

## Expected Deliverables

**Phase 1 - Core Server:**

- TCP server using `net.createServer()`
- Frame parser with incremental buffer handling
- Room-based message routing via EventEmitter
- Heartbeat mechanism to detect dead connections

**Phase 2 - CLI Client:**

- Simple CLI tool: `relay-client connect/join/send`
- Encodes/decodes frames, uses stdin/stdout
- This is the primary demo tool, test harness, and debugger

**Phase 3 - Observability:**

- `RELAY_DEBUG=1` mode showing raw frames, backpressure, buffer states
- Chaos testing script (`demo:chaos`) - many clients, random behavior, memory/lag metrics

## File Structure Convention

```
relay/
├── apps/
│   ├── server/              # Runnable TCP server
│   │   ├── src/
│   │   │   ├── index.ts           # Entry point
│   │   │   ├── server.ts          # TCP server setup
│   │   │   ├── connection/
│   │   │   │   ├── connection.ts  # Per-socket lifecycle + state machine
│   │   │   │   └── connectionManager.ts
│   │   │   ├── rooms/
│   │   │   │   ├── room.ts        # Room domain logic
│   │   │   │   └── roomManager.ts
│   │   │   ├── handlers/          # Message-type handlers
│   │   │   │   ├── hello.ts
│   │   │   │   ├── joinRoom.ts
│   │   │   │   ├── leaveRoom.ts
│   │   │   │   └── message.ts
│   │   │   └── observability/
│   │   │       ├── logger.ts
│   │   │       └── metrics.ts
│   │   └── package.json
│   └── client/              # CLI demo client
│       ├── src/
│       │   ├── index.ts
│       │   ├── cli.ts
│       │   ├── client.ts
│       │   ├── commands/
│       │   │   ├── connect.ts
│       │   │   ├── join.ts
│       │   │   └── send.ts
│       │   └── output.ts
│       └── package.json
├── packages/
│   ├── protocol/            # Pure protocol logic (no sockets)
│   │   ├── src/
│   │   │   ├── constants.ts
│   │   │   ├── types.ts
│   │   │   ├── flags.ts
│   │   │   ├── encoder.ts       # Frame → Buffer
│   │   │   ├── decoder.ts       # Buffer → Frame
│   │   │   ├── frame.ts
│   │   │   └── errors.ts
│   │   └── package.json
│   ├── transport/           # Stream/socket abstractions
│   │   ├── src/
│   │   │   ├── tcpServer.ts
│   │   │   ├── tcpClient.ts
│   │   │   ├── socketWriter.ts
│   │   │   ├── backpressure.ts
│   │   │   └── types.ts
│   │   └── package.json
│   └── core/                # Event-driven domain logic
│       ├── src/
│       │   ├── eventBus.ts
│       │   ├── router.ts
│       │   ├── lifecycle.ts
│       │   └── types.ts
│       └── package.json
├── scripts/
│   ├── chaos.ts             # Stress testing
│   ├── load.ts
│   └── fragmentation.ts
├── docs/
│   ├── protocol.md
│   ├── architecture.md
│   └── decisions.md
└── package.json             # Root workspace config
```

**Key separation**: `packages/protocol` knows nothing about sockets. `apps/server` uses `protocol` + `transport` packages. This allows independent testing and future protocol reuse.

## Error Handling

- Invalid frame length (0, negative, or > 10MB): ERROR frame + close
- Unsupported protocol version: ERROR frame + close
- Unknown message type: ERROR frame + close
- Invalid JSON when UTF-8 flag set: ERROR frame + close
- Log all errors with connection ID and raw frame bytes for debugging

## Connection State Machine

The Connection follows a strict state machine (see [state-machine.md](../state-machine.md)):

```
INIT → OPEN ⟷ DRAINING → CLOSING → CLOSED
```

**States**:

- `INIT`: Socket attached, listeners wired, no data flow yet
- `OPEN`: Normal operation - parsing and sending frames
- `DRAINING`: Outbound backpressure detected (`socket.write()` returned false)
- `CLOSING`: Graceful shutdown in progress, no new frames accepted
- `CLOSED`: Terminal state, socket destroyed

**Critical invariants**:

- Only `OPEN ⟷ DRAINING` is reversible (on `drain` event)
- All other transitions are one-way
- Frame events emitted only in `OPEN` or `DRAINING`
- Connection emits `close` exactly once

## Testing Patterns (Vitest)

- **Unit tests**: Fragment frames across multiple chunks, combine multiple frames in one chunk
- **Protocol tests**: Invalid lengths, unsupported versions, malformed payloads
- **State machine tests**: Verify state transitions, backpressure handling, error paths
- **Integration**: Connect multiple clients, join same room, verify broadcast
- **Chaos scripts**: Slow consumers, intentional socket pauses, random disconnects
- **Metrics**: Track memory usage, event loop lag, socket counts under load

Use Vitest's `describe`, `it`, `expect`. Mock sockets with fake Duplex streams for unit tests.

## Key Constraints

- No database, no persistence - this is pure in-memory networking
- No authentication - focus is on protocol correctness
- No HTTP/WebSocket initially - raw TCP only (future extension point)
- No compression yet - flag reserved but not implemented

## TypeScript Guidelines

- Use **strict mode** (`tsconfig.json`: `"strict": true`)
- Explicit types for public APIs, infer for locals
- Use ES modules syntax (`import`/`export`)
- Prefer `type` over `interface` for protocol structures
- Keep Node.js `Buffer` native, don't wrap unnecessarily
- Use `EventEmitter` from `node:events` with typed `.on()` methods

Example frame type:

```typescript
export type Frame = {
  length: number;
  version: number;
  type: MessageType;
  flags: number;
  payload: Buffer;
};
```

## Success Criteria

Code is ready when:

1. A new client implementation can be written by reading protocol docs alone
2. Server survives malicious/malformed frames without crashing
3. Backpressure is observable and handled correctly
4. Debug output shows exactly what's happening at the byte level
5. Connection state machine enforces all invariants at runtime

Read [outcome.md](../outcome.md) for the philosophical framing and [connection.md](../connection.md) for the authoritative Connection design.
