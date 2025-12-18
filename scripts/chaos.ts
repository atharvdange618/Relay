#!/usr/bin/env tsx
/**
 * Chaos Testing Script
 *
 * Spawns multiple clients that exhibit chaotic behavior:
 * - Random disconnects (abrupt socket closure)
 * - Slow consumers (intentional read pauses)
 * - Burst message sending
 * - Random room joins/leaves
 *
 * This tests:
 * - Connection state machine stability
 * - Room cleanup on abrupt disconnect
 * - Backpressure handling
 * - Memory leaks and resource cleanup
 */

import { Socket } from "net";
import { encodeFrame } from "../packages/protocol/src/frame.js";
import { MessageType } from "../packages/protocol/src/constants.js";

// Configuration
const CONFIG = {
  host: "127.0.0.1",
  port: 4000,
  clientCount: 20, // Number of concurrent clients
  durationMs: 60000, // Run for 60 seconds
  disconnectProbability: 0.15, // 15% chance to disconnect per action cycle
  slowConsumerProbability: 0.2, // 20% chance to pause consumption
  burstMessageCount: 10, // Messages per burst
};

const ROOMS = ["chaos-alpha", "chaos-beta", "chaos-gamma", "chaos-delta"];

interface ChaosClient {
  id: number;
  socket: Socket;
  currentRoom?: string;
  messageCount: number;
  disconnected: boolean;
}

class ChaosTest {
  private clients: ChaosClient[] = [];
  private startTime: number = 0;
  private stats = {
    connectionsCreated: 0,
    messagesSent: 0,
    abruptDisconnects: 0,
    gracefulDisconnects: 0,
    errors: 0,
  };

  /**
   * Run the chaos test
   */
  async run(): Promise<void> {
    console.log("🌪️  Chaos Test Starting...");
    console.log(`Clients: ${CONFIG.clientCount}`);
    console.log(`Duration: ${CONFIG.durationMs / 1000}s`);
    console.log(
      `Disconnect Probability: ${CONFIG.disconnectProbability * 100}%`
    );
    console.log();

    this.startTime = Date.now();

    // Spawn clients with staggered start
    for (let i = 0; i < CONFIG.clientCount; i++) {
      await this.spawnClient(i);
      await this.sleep(100); // Stagger connections
    }

    // Let chaos run for configured duration
    await this.sleep(CONFIG.durationMs);

    // Cleanup
    console.log("\n🛑 Test duration complete, cleaning up...");
    await this.cleanup();

    // Print results
    this.printStats();
  }

  /**
   * Spawn a single chaotic client
   */
  private async spawnClient(id: number): Promise<void> {
    const socket = new Socket();
    const client: ChaosClient = {
      id,
      socket,
      messageCount: 0,
      disconnected: false,
    };

    this.clients.push(client);
    this.stats.connectionsCreated++;

    socket.on("error", (err) => {
      this.stats.errors++;
      console.log(`[Client ${id}] Error: ${err.message}`);
    });

    socket.on("close", () => {
      client.disconnected = true;
    });

    // Connect
    socket.connect(CONFIG.port, CONFIG.host, () => {
      console.log(`[Client ${id}] Connected`);

      // Send HELLO
      this.sendHello(client);

      // Start chaotic behavior
      this.startChaos(client);
    });
  }

  /**
   * Send HELLO frame
   */
  private sendHello(client: ChaosClient): void {
    const payload = {
      userId: `chaos-${client.id}`,
      clientVersion: "chaos-1.0",
    };
    const frame = encodeFrame(MessageType.HELLO, payload);
    client.socket.write(frame.buffer);
  }

  /**
   * Start chaotic behavior loop
   */
  private async startChaos(client: ChaosClient): Promise<void> {
    while (!client.disconnected && this.isRunning()) {
      try {
        await this.performRandomAction(client);
        await this.sleep(this.randomDelay(500, 3000));
      } catch (err) {
        // Client might have disconnected
        break;
      }
    }
  }

  /**
   * Perform a random action
   */
  private async performRandomAction(client: ChaosClient): Promise<void> {
    // Check if should disconnect
    if (Math.random() < CONFIG.disconnectProbability) {
      this.abruptDisconnect(client);
      return;
    }

    // Check if should pause (slow consumer)
    if (Math.random() < CONFIG.slowConsumerProbability) {
      await this.slowConsumerPause(client);
    }

    // Random action
    const action = Math.random();

    if (!client.currentRoom && action < 0.7) {
      // 70% chance to join room if not in one
      this.joinRandomRoom(client);
    } else if (client.currentRoom && action < 0.3) {
      // 30% chance to leave current room
      this.leaveRoom(client);
    } else if (client.currentRoom) {
      // Send burst of messages
      this.sendMessageBurst(client);
    }
  }

  /**
   * Join a random room
   */
  private joinRandomRoom(client: ChaosClient): void {
    const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
    client.currentRoom = room;

    const frame = encodeFrame(MessageType.JOIN_ROOM, { room });
    client.socket.write(frame.buffer);

    console.log(`[Client ${client.id}] Joined room: ${room}`);
  }

  /**
   * Leave current room
   */
  private leaveRoom(client: ChaosClient): void {
    if (!client.currentRoom) return;

    const frame = encodeFrame(MessageType.LEAVE_ROOM, {
      room: client.currentRoom,
    });
    client.socket.write(frame.buffer);

    console.log(`[Client ${client.id}] Left room: ${client.currentRoom}`);
    client.currentRoom = undefined;
  }

  /**
   * Send burst of messages
   */
  private sendMessageBurst(client: ChaosClient): void {
    if (!client.currentRoom) return;

    const count = Math.ceil(Math.random() * CONFIG.burstMessageCount);

    for (let i = 0; i < count; i++) {
      const frame = encodeFrame(MessageType.MESSAGE, {
        room: client.currentRoom,
        content: `Chaos message ${client.messageCount++} from client ${
          client.id
        }`,
      });
      client.socket.write(frame.buffer);
      this.stats.messagesSent++;
    }

    console.log(
      `[Client ${client.id}] Sent burst of ${count} messages to ${client.currentRoom}`
    );
  }

  /**
   * Abruptly disconnect (no graceful leave)
   */
  private abruptDisconnect(client: ChaosClient): void {
    console.log(
      `[Client ${client.id}] 💥 Abrupt disconnect (was in room: ${
        client.currentRoom || "none"
      })`
    );
    client.socket.destroy();
    client.disconnected = true;
    this.stats.abruptDisconnects++;
  }

  /**
   * Simulate slow consumer (pause socket reading)
   */
  private async slowConsumerPause(client: ChaosClient): Promise<void> {
    const pauseDuration = this.randomDelay(1000, 5000);
    console.log(
      `[Client ${client.id}] 🐢 Slow consumer pause (${pauseDuration}ms)`
    );

    client.socket.pause();
    await this.sleep(pauseDuration);
    client.socket.resume();
  }

  /**
   * Graceful cleanup
   */
  private async cleanup(): Promise<void> {
    for (const client of this.clients) {
      if (!client.disconnected) {
        // Gracefully leave room and disconnect
        if (client.currentRoom) {
          this.leaveRoom(client);
        }
        client.socket.end();
        this.stats.gracefulDisconnects++;
      }
    }

    // Wait for cleanup
    await this.sleep(1000);
  }

  /**
   * Check if test is still running
   */
  private isRunning(): boolean {
    return Date.now() - this.startTime < CONFIG.durationMs;
  }

  /**
   * Random delay between min and max ms
   */
  private randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Print test statistics
   */
  private printStats(): void {
    const duration = (Date.now() - this.startTime) / 1000;

    console.log("\n📊 Chaos Test Results:");
    console.log(`  Duration:             ${duration.toFixed(2)}s`);
    console.log(`  Connections Created:  ${this.stats.connectionsCreated}`);
    console.log(`  Messages Sent:        ${this.stats.messagesSent}`);
    console.log(`  Abrupt Disconnects:   ${this.stats.abruptDisconnects}`);
    console.log(`  Graceful Disconnects: ${this.stats.gracefulDisconnects}`);
    console.log(`  Errors:               ${this.stats.errors}`);
    console.log(
      `  Messages/sec:         ${(this.stats.messagesSent / duration).toFixed(
        2
      )}`
    );
    console.log();
    console.log(
      "✅ Check server logs for room cleanup and connection state transitions"
    );
  }
}

// Run the test
const test = new ChaosTest();
test.run().catch((err) => {
  console.error("Chaos test failed:", err);
  process.exit(1);
});
