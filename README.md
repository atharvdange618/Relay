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

_Implementation in progress. See [thought-process/](thought-process/) for complete design specifications._

```bash
# Start server
npm run server

# Connect client
npm run client connect localhost:4000
npm run client join physics-nerds
npm run client send "hello world"

# Debug mode (verbose logging)
RELAY_DEBUG=1 npm run server

# Stress test
npm run demo:chaos
```

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
- **Testing**: Vitest
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
