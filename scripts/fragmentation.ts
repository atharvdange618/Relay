#!/usr/bin/env tsx
/**
 * Fragmentation Testing Script
 *
 * Sends frames byte-by-byte to test incremental parsing.
 * This tests:
 * - Parser handles arbitrary packet boundaries
 * - Frames can be split across any byte boundary
 * - Combined frames in single TCP packet work correctly
 * - No off-by-one errors in buffer management
 */

import { Socket } from "net";
import { encodeFrame, extractFrame } from "../packages/protocol/src/frame.js";
import { MessageType } from "../packages/protocol/src/constants.js";

// Configuration
const CONFIG = {
  host: "127.0.0.1",
  port: 4000,
  testCases: [
    "Byte-by-byte fragmentation",
    "Split at header boundary",
    "Split mid-payload",
    "Multiple frames in one write",
    "Random fragmentation",
  ],
};

class FragmentationTest {
  private socket: Socket | null = null;
  private receivedFrames: number = 0;
  private testsPassed: number = 0;
  private testsFailed: number = 0;
  private recvBuffer: Buffer = Buffer.alloc(0);

  /**
   * Run all fragmentation tests
   */
  async run(): Promise<void> {
    console.log("🧩 Fragmentation Test Starting...");
    console.log();

    try {
      await this.connect();

      // Test 1: Byte-by-byte
      await this.testByteByByte();

      // Test 2: Header boundary split
      await this.testHeaderBoundarySplit();

      // Test 3: Mid-payload split
      await this.testMidPayloadSplit();

      // Test 4: Multiple frames combined
      await this.testMultipleFramesCombined();

      // Test 5: Random fragmentation
      await this.testRandomFragmentation();

      await this.cleanup();

      this.printResults();
    } catch (err) {
      console.error("❌ Test failed:", err);
      process.exit(1);
    }
  }

  /**
   * Connect to server
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();

      this.socket.on("data", (chunk: Buffer) => {
        // Parse incoming server responses
        this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);

        // Extract and count all complete frames
        while (this.recvBuffer.length > 0) {
          const result = extractFrame(this.recvBuffer);
          if (!result) break; // Need more data

          this.receivedFrames++;
          this.recvBuffer = result.remaining;
        }
      });

      this.socket.on("error", (err) => {
        reject(err);
      });

      this.socket.connect(CONFIG.port, CONFIG.host, () => {
        console.log("✅ Connected to server\n");
        resolve();
      });
    });
  }

  /**
   * Test 1: Send frame byte-by-byte
   */
  private async testByteByByte(): Promise<void> {
    console.log("Test 1: Byte-by-byte fragmentation");

    const payload = { userId: "frag-test", clientVersion: "1.0" };
    const frame = encodeFrame(MessageType.HELLO, payload);

    console.log(`  Sending ${frame.buffer.length} bytes one at a time...`);

    for (let i = 0; i < frame.buffer.length; i++) {
      this.socket!.write(frame.buffer.subarray(i, i + 1));
      await this.sleep(5); // Small delay between bytes
    }

    await this.sleep(500); // Wait for server response

    if (this.receivedFrames >= 1) {
      console.log("  ✅ PASSED - Frame parsed correctly\n");
      this.testsPassed++;
    } else {
      console.log("  ❌ FAILED - Frame not received\n");
      this.testsFailed++;
    }
  }

  /**
   * Test 2: Split at header boundary (7 bytes)
   */
  private async testHeaderBoundarySplit(): Promise<void> {
    console.log("Test 2: Split at header boundary");

    const payload = { room: "test-room" };
    const frame = encodeFrame(MessageType.JOIN_ROOM, payload);

    console.log("  Sending header (7 bytes), then payload...");

    // Send header
    this.socket!.write(frame.buffer.subarray(0, 7));
    await this.sleep(50);

    // Send payload
    this.socket!.write(frame.buffer.subarray(7));
    await this.sleep(500);

    if (this.receivedFrames >= 2) {
      console.log("  ✅ PASSED - Split frame parsed correctly\n");
      this.testsPassed++;
    } else {
      console.log("  ❌ FAILED - Frame not received\n");
      this.testsFailed++;
    }
  }

  /**
   * Test 3: Split mid-payload
   */
  private async testMidPayloadSplit(): Promise<void> {
    console.log("Test 3: Split mid-payload");

    const payload = {
      room: "test-room",
      content:
        "This is a longer message that will be split in the middle of the payload",
    };
    const frame = encodeFrame(MessageType.MESSAGE, payload);

    const splitPoint = Math.floor(frame.buffer.length / 2);
    console.log(
      `  Sending ${frame.buffer.length} bytes split at byte ${splitPoint}...`
    );

    // Send first half
    this.socket!.write(frame.buffer.subarray(0, splitPoint));
    await this.sleep(50);

    // Send second half
    this.socket!.write(frame.buffer.subarray(splitPoint));
    await this.sleep(100);

    // MESSAGE frames don't get responses when alone in room
    // Success means no error/disconnect (server parsed it correctly)
    if (this.socket && !this.socket.destroyed) {
      console.log("  ✅ PASSED - Mid-payload split handled correctly\n");
      this.testsPassed++;
    } else {
      console.log("  ❌ FAILED - Connection closed (parse error)\n");
      this.testsFailed++;
    }
  }

  /**
   * Test 4: Multiple frames in single write
   */
  private async testMultipleFramesCombined(): Promise<void> {
    console.log("Test 4: Multiple frames in one write");

    const frame1 = encodeFrame(MessageType.MESSAGE, {
      room: "test-room",
      content: "Message 1",
    });

    const frame2 = encodeFrame(MessageType.MESSAGE, {
      room: "test-room",
      content: "Message 2",
    });

    const frame3 = encodeFrame(MessageType.MESSAGE, {
      room: "test-room",
      content: "Message 3",
    });

    // Combine all frames into one buffer
    const combined = Buffer.concat([
      frame1.buffer,
      frame2.buffer,
      frame3.buffer,
    ]);

    console.log(
      `  Sending 3 frames (${combined.length} bytes) in one write...`
    );
    this.socket!.write(combined);
    await this.sleep(100);

    // MESSAGE frames don't get responses when alone in room
    // Success means no error/disconnect (server parsed all 3)
    if (this.socket && !this.socket.destroyed) {
      console.log("  ✅ PASSED - Multiple frames parsed correctly\n");
      this.testsPassed++;
    } else {
      console.log("  ❌ FAILED - Connection closed (parse error)\n");
      this.testsFailed++;
    }
  }

  /**
   * Test 5: Random fragmentation
   */
  private async testRandomFragmentation(): Promise<void> {
    console.log("Test 5: Random fragmentation");

    const payload = {
      room: "test-room",
      content:
        "Testing random fragmentation with a moderately long message payload",
    };
    const frame = encodeFrame(MessageType.MESSAGE, payload);

    console.log("  Sending frame with random chunk sizes...");

    let offset = 0;
    while (offset < frame.buffer.length) {
      const chunkSize = Math.floor(Math.random() * 10) + 1; // 1-10 bytes
      const end = Math.min(offset + chunkSize, frame.buffer.length);

      this.socket!.write(frame.buffer.subarray(offset, end));
      offset = end;

      await this.sleep(Math.random() * 10); // Random delay 0-10ms
    }

    await this.sleep(100);

    // MESSAGE frames don't get responses when alone in room
    // Success means no error/disconnect (server parsed it)
    if (this.socket && !this.socket.destroyed) {
      console.log("  ✅ PASSED - Random fragmentation handled correctly\n");
      this.testsPassed++;
    } else {
      console.log("  ❌ FAILED - Connection closed (parse error)\n");
      this.testsFailed++;
    }
  }

  /**
   * Cleanup
   */
  private async cleanup(): Promise<void> {
    if (this.socket) {
      // Send LEAVE_ROOM
      const frame = encodeFrame(MessageType.LEAVE_ROOM, { room: "test-room" });
      this.socket.write(frame.buffer);

      await this.sleep(500);
      this.socket.end();
      await this.sleep(300);
    }
  }

  /**
   * Print test results
   */
  private printResults(): void {
    console.log("📊 Fragmentation Test Results:");
    console.log(`  Total Tests:  ${CONFIG.testCases.length}`);
    console.log(`  Passed:       ${this.testsPassed}`);
    console.log(`  Failed:       ${this.testsFailed}`);
    console.log(`  Frames Received: ${this.receivedFrames}`);
    console.log();

    if (this.testsFailed === 0) {
      console.log("✅ All fragmentation tests passed!");
      console.log("   Parser correctly handles arbitrary packet boundaries");
    } else {
      console.log("❌ Some tests failed - check frame parsing logic");
      process.exit(1);
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Run the test
const test = new FragmentationTest();
test.run().catch((err) => {
  console.error("Fragmentation test failed:", err);
  process.exit(1);
});
