#!/usr/bin/env node
/**
 * Relay Server Entry Point
 */

import { RelayServer } from "./server.js";

const server = new RelayServer();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n Received SIGINT, shutting down gracefully...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n Received SIGTERM, shutting down gracefully...");
  await server.stop();
  process.exit(0);
});

// Start server
server.start().catch((err) => {
  console.error(" Failed to start server:", err);
  process.exit(1);
});
