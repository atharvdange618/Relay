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
│   ├── transport/     # Stream abstractions & backpressure
│   └── core/          # Event-driven domain logic
├── scripts/           # Chaos testing, load tests
└── docs/              # Protocol specs, architecture decisions
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

## Documentation

- [Project Overview](thought-process/project-overview.md) - Protocol specification and parsing strategy
- [Connection Design](thought-process/connection.md) - Per-socket lifecycle and responsibilities
- [State Machine](thought-process/state-machine.md) - Connection state transitions and invariants
- [Project Structure](thought-process/project-structure.md) - Monorepo architecture rationale
- [Outcome](thought-process/outcome.md) - Philosophy and success criteria

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js (core modules only)
- **Build Tool**: tsx for TypeScript execution
- **Modules**: ES modules (`import`/`export`)

## Success Criteria

This project succeeds when:

1. A new client implementation can be written by reading protocol docs alone
2. The server survives malicious/malformed frames without crashing
3. Backpressure is observable and handled correctly
4. Debug output shows exactly what's happening at the byte level
5. The Connection state machine enforces all invariants at runtime

---

**This is infrastructure.** Not a chat app, not a product. A reference implementation for real-time networking at the systems level.
