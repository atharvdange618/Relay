# Relay

A real-time TCP message relay engine built to deeply understand Node.js at the systems level.

## What is Relay?

Relay is **infrastructure** — a production-grade message relay server that demonstrates:

- Binary frame-based protocol design
- TCP stream handling with backpressure
- Incremental buffer parsing across packet boundaries
- Event-driven architecture with strict state machines
- Room-based message routing

This is not a UI project. No frameworks, no auth, no dashboards. Just core Node.js networking primitives: `net`, `events`, `buffer`.

## Architecture

**Binary Protocol:**

```
| length (4B) | version (1B) | type (1B) | flags (1B) | payload (variable) |
```

All numeric fields use Big Endian (network byte order).

**Message Types:**

- `HELLO`, `JOIN_ROOM`, `LEAVE_ROOM`, `MESSAGE`, `HEARTBEAT`, `ERROR`

**Connection Lifecycle:**

```
INIT → OPEN ⟷ DRAINING → CLOSING → CLOSED
```

## Project Structure

```
relay/
├── apps/
│   ├── server/        # TCP server (net.createServer)
│   └── client/        # CLI demo client
├── packages/
│   ├── protocol/      # Frame encoding/decoding (socket-agnostic)
│   └── transport/     # Connection management & backpressure
├── scripts/           # Chaos, load, and fragmentation tests
└── docs/              # Protocol specification & architecture
```

## Quick Start

### Prerequisites

- Node.js v18+
- No additional dependencies (uses Node core modules only)

### Installation

```bash
git clone https://github.com/atharvdange618/Relay.git
cd Relay
npm install
```

### Running the Server

```bash
# Start server (default: localhost:4000)
npm run server

# Debug mode (verbose logging)
npm run server:debug
```

The server will start on port 4000 and display connection and message activity.

### Using the CLI Client

In a separate terminal:

```bash
# Connect to server (default: localhost:4000)
npm run client

# Or specify host/port (without flags)
npm run client localhost 4000
```

Once connected, use these commands in the CLI:

```
join <room>       - Join a room (e.g., "join physics-nerds")
send <message>    - Send message to current room
leave <room>      - Leave a room
heartbeat         - Send heartbeat to server
help              - Show available commands
quit / exit       - Disconnect and exit
```

### Demo: Two Clients Chatting

**Terminal 1** - Start server:

```bash
npm run server
```

**Terminal 2** - First client:

```bash
npm run client
> join physics
> send Hello from client 1!
```

**Terminal 3** - Second client:

```bash
npm run client
> join physics
> send Hello from client 2!
```

Both clients will see each other's messages in real-time.

### Available Commands

```bash
npm run server        # Start production server
npm run server:dev    # Start server with auto-reload
npm run server:debug  # Start server with verbose logging
npm run client        # Connect client to localhost:4000
npm run typecheck     # Verify TypeScript types
npm run clean         # Clean build artifacts
```

### Troubleshooting

- **Port already in use**: The server defaults to port 4000. Kill any processes using this port or modify `apps/server/src/config.ts`
- **Connection refused**: Ensure the server is running before starting the client
- **TypeScript errors**: Run `npm run typecheck` to verify all types are correct

## Why This Exists

Relay is a learning project focused on understanding:

- How TCP really works (byte streams, not messages)
- Node.js stream backpressure handling
- Binary protocol design and parsing strategies
- State machine enforcement at runtime
- Observable system behavior under stress

If you clone this repo, you should understand what it does, how it behaves, and why it exists within 10 minutes.

## Testing

Relay includes comprehensive stress tests to validate production readiness:

```bash
# Chaos test: 20 clients with random disconnects and slow consumers
npm run demo:chaos

# Load test: 100 concurrent clients sending steady traffic
npm run demo:load

# Fragmentation test: Validate parser handles arbitrary packet boundaries
npm run demo:fragmentation
```

**Test Results:**

- ✅ **Chaos**: 19 abrupt disconnects handled, 0 errors, perfect room cleanup
- ✅ **Load**: 100/100 clients connected, 160 msg/sec throughput, 0 errors
- ✅ **Fragmentation**: 5/5 edge cases passed (byte-by-byte, header splits, combined frames)

## Documentation

- [Protocol Specification](docs/protocol.md) - Complete binary protocol reference with wire format examples
- [Architecture](docs/architecture.md) - System design, component interactions, and architectural decisions
- [Project Overview](docs/project-overview.md) - High-level goals and philosophy

**Key Topics Covered:**

- Binary frame encoding/decoding with Big Endian byte order
- Incremental frame parsing across arbitrary packet boundaries
- Connection state machine (INIT → OPEN ⟷ DRAINING → CLOSING → CLOSED)
- TCP backpressure handling and buffer management
- Room-based message broadcasting with O(N) amplification
- Stress testing: chaos (abrupt disconnects), load (100 clients), fragmentation (byte-by-byte)

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js (core modules only)
- **Build Tool**: tsx for TypeScript execution
- **Modules**: ES modules (`import`/`export`)

## Success Criteria ✅

This project succeeds when:

1. ✅ **Protocol Documentation**: New client can be implemented from docs alone
2. ✅ **Robustness**: Server survives malicious/malformed frames (validated in chaos test)
3. ✅ **Backpressure**: Observable via RELAY_DEBUG=1, state transitions logged
4. ✅ **Debuggability**: Frame-level logging shows type, version, flags, payload size
5. ✅ **State Machine**: Connection enforces all invariants (one-way transitions, exactly-once close)

**All criteria met. Relay is complete for its learning objectives.**

## What's Next?

This is a **complete learning project**. If you want to extend it:

- **Production**: Add authentication (API keys), TLS encryption, rate limiting
- **Features**: Presence tracking, message history, direct messages
- **Scale**: Horizontal scaling with Redis pub/sub, WebSocket bridge for browsers
- **Testing**: Add unit tests with Vitest for protocol package

---

**This is infrastructure.** Not a chat app, not a product. A reference implementation for real-time networking at the systems level.
