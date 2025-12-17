#!/usr/bin/env node
/**
 * Relay CLI Client Entry Point
 */

import { RelayCLI } from "./cli.js";

const host = process.argv[2] || "localhost";
const port = parseInt(process.argv[3] || "4000", 10);

const cli = new RelayCLI();

cli.start(host, port).catch((err) => {
  console.error("Failed to connect:", err.message);
  process.exit(1);
});
