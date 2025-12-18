#!/usr/bin/env tsx
/**
 * Load Testing Script
 *
 * Spawns 100+ concurrent connections that send steady message traffic.
 * This tests:
 * - High connection count scalability
 * - Message throughput under load
 * - Memory usage with many active connections
 * - Server performance metrics (messages/sec)
 */

import { Socket } from "net";
import { encodeFrame } from "../packages/protocol/src/frame.js";
import { MessageType } from "../packages/protocol/src/constants.js";

// Configuration
const CONFIG = {
  host: "127.0.0.1",
  port: 4000,
  clientCount: 100, // Number of concurrent clients
  durationMs: 30000, // Run for 30 seconds
  messagesPerClient: 50, // Total messages each client will send
  messageIntervalMs: 600, // Time between messages (600ms = ~1.6 msg/sec per client)
};

const ROOMS = ["load-test-1", "load-test-2", "load-test-3"];

interface LoadClient {
  id: number;
  socket: Socket;
  room: string;
  messagesSent: number;
  connected: boolean;
}

class LoadTest {
  private clients: LoadClient[] = [];
  private startTime: number = 0;
  private stats = {
    connectionsCreated: 0,
    messagesSent: 0,
    errors: 0,
    bytesReceived: 0,
  };

  /**
   * Run the load test
   */
  async run(): Promise<void> {
    console.log("📈 Load Test Starting...");
    console.log(`Clients: ${CONFIG.clientCount}`);
    console.log(`Duration: ${CONFIG.durationMs / 1000}s`);
    console.log(
      `Target messages: ${CONFIG.clientCount * CONFIG.messagesPerClient}`
    );
    console.log(
      `Expected throughput: ~${(
        (CONFIG.clientCount / CONFIG.messageIntervalMs) *
        1000
      ).toFixed(0)} msg/sec`
    );
    console.log();

    this.startTime = Date.now();

    // Spawn all clients rapidly
    console.log("Spawning clients...");
    const spawnPromises = [];
    for (let i = 0; i < CONFIG.clientCount; i++) {
      spawnPromises.push(this.spawnClient(i));
    }

    await Promise.all(spawnPromises);
    console.log(`All ${CONFIG.clientCount} clients connected!\n`);

    // Wait for test duration
    await this.sleep(CONFIG.durationMs);

    // Cleanup
    console.log("\n🛑 Test duration complete, cleaning up...");
    await this.cleanup();

    // Print results
    this.printStats();
  }

  /**
   * Spawn a single load test client
   */
  private async spawnClient(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const room = ROOMS[id % ROOMS.length]!; // Distribute clients across rooms

      const client: LoadClient = {
        id,
        socket,
        room,
        messagesSent: 0,
        connected: false,
      };

      this.clients.push(client);

      socket.on("error", (err) => {
        this.stats.errors++;
        if (!client.connected) {
          reject(err);
        }
      });

      socket.on("data", (data: Buffer) => {
        this.stats.bytesReceived += data.length;
      });

      socket.on("close", () => {
        client.connected = false;
      });

      // Connect
      socket.connect(CONFIG.port, CONFIG.host, () => {
        client.connected = true;
        this.stats.connectionsCreated++;

        // Send HELLO
        this.sendHello(client);

        // Join room
        setTimeout(() => {
          this.joinRoom(client);

          // Start sending messages
          this.startMessaging(client);
        }, 100);

        resolve();
      });

      // Connection timeout
      setTimeout(() => {
        if (!client.connected) {
          reject(new Error(`Client ${id} failed to connect`));
        }
      }, 5000);
    });
  }

  /**
   * Send HELLO frame
   */
  private sendHello(client: LoadClient): void {
    const payload = {
      userId: `load-user-${client.id}`,
      clientVersion: "load-1.0",
    };
    const frame = encodeFrame(MessageType.HELLO, payload);
    client.socket.write(frame.buffer);
  }

  /**
   * Join room
   */
  private joinRoom(client: LoadClient): void {
    const frame = encodeFrame(MessageType.JOIN_ROOM, { room: client.room });
    client.socket.write(frame.buffer);
  }

  /**
   * Start steady message sending
   */
  private async startMessaging(client: LoadClient): Promise<void> {
    const interval = setInterval(() => {
      if (
        !client.connected ||
        !this.isRunning() ||
        client.messagesSent >= CONFIG.messagesPerClient
      ) {
        clearInterval(interval);
        return;
      }

      this.sendMessage(client);
      client.messagesSent++;
    }, CONFIG.messageIntervalMs);
  }

  /**
   * Send a message
   */
  private sendMessage(client: LoadClient): void {
    const frame = encodeFrame(MessageType.MESSAGE, {
      room: client.room,
      content: `Load test message ${client.messagesSent} from client ${client.id}`,
    });
    client.socket.write(frame.buffer);
    this.stats.messagesSent++;
  }

  /**
   * Graceful cleanup
   */
  private async cleanup(): Promise<void> {
    const leavePromises = [];

    for (const client of this.clients) {
      if (client.connected) {
        // Leave room
        const frame = encodeFrame(MessageType.LEAVE_ROOM, {
          room: client.room,
        });
        client.socket.write(frame.buffer);

        // Close connection
        leavePromises.push(
          new Promise<void>((resolve) => {
            client.socket.once("close", () => resolve());
            client.socket.end();
            setTimeout(() => resolve(), 1000); // Timeout after 1s
          })
        );
      }
    }

    await Promise.all(leavePromises);
    await this.sleep(500);
  }

  /**
   * Check if test is still running
   */
  private isRunning(): boolean {
    return Date.now() - this.startTime < CONFIG.durationMs;
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

    console.log("\n📊 Load Test Results:");
    console.log(`  Duration:             ${duration.toFixed(2)}s`);
    console.log(
      `  Connections Created:  ${this.stats.connectionsCreated}/${CONFIG.clientCount}`
    );
    console.log(`  Messages Sent:        ${this.stats.messagesSent}`);
    console.log(
      `  Bytes Received:       ${this.formatBytes(this.stats.bytesReceived)}`
    );
    console.log(`  Errors:               ${this.stats.errors}`);
    console.log(
      `  Messages/sec:         ${(this.stats.messagesSent / duration).toFixed(
        2
      )}`
    );
    console.log();

    if (
      this.stats.connectionsCreated === CONFIG.clientCount &&
      this.stats.errors === 0
    ) {
      console.log("✅ All clients connected successfully, zero errors!");
    } else {
      console.log(
        `⚠️  ${
          CONFIG.clientCount - this.stats.connectionsCreated
        } clients failed to connect`
      );
    }

    console.log("\n✅ Check server metrics for memory usage and throughput");
  }

  /**
   * Format bytes to human-readable
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }
}

// Run the test
const test = new LoadTest();
test.run().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
