/**
 * Server metrics tracking
 */

export class Metrics {
  private connectionCount: number = 0;
  private roomCount: number = 0;
  private totalBytesSent: number = 0;
  private totalBytesReceived: number = 0;
  private messagesProcessed: number = 0;
  private startTime: number = Date.now();

  /**
   * Increment connection count
   */
  connectionOpened(): void {
    this.connectionCount++;
  }

  /**
   * Decrement connection count
   */
  connectionClosed(): void {
    this.connectionCount = Math.max(0, this.connectionCount - 1);
  }

  /**
   * Update room count
   */
  setRoomCount(count: number): void {
    this.roomCount = count;
  }

  /**
   * Track bytes sent
   */
  bytesSent(bytes: number): void {
    this.totalBytesSent += bytes;
  }

  /**
   * Track bytes received
   */
  bytesReceived(bytes: number): void {
    this.totalBytesReceived += bytes;
  }

  /**
   * Increment message count
   */
  messageProcessed(): void {
    this.messagesProcessed++;
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot() {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeSec = Math.floor(uptimeMs / 1000);

    return {
      uptime: `${uptimeSec}s`,
      connections: this.connectionCount,
      rooms: this.roomCount,
      totalBytesSent: this.formatBytes(this.totalBytesSent),
      totalBytesReceived: this.formatBytes(this.totalBytesReceived),
      messagesProcessed: this.messagesProcessed,
      messagesPerSecond:
        uptimeSec > 0
          ? (this.messagesProcessed / uptimeSec).toFixed(2)
          : "0.00",
    };
  }

  /**
   * Format bytes to human-readable
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  /**
   * Print metrics to console
   */
  print(): void {
    const snapshot = this.getSnapshot();
    console.log("\n📊 Server Metrics:");
    console.log(`  Uptime:              ${snapshot.uptime}`);
    console.log(`  Active Connections:  ${snapshot.connections}`);
    console.log(`  Active Rooms:        ${snapshot.rooms}`);
    console.log(`  Bytes Sent:          ${snapshot.totalBytesSent}`);
    console.log(`  Bytes Received:      ${snapshot.totalBytesReceived}`);
    console.log(`  Messages Processed:  ${snapshot.messagesProcessed}`);
    console.log(`  Messages/sec:        ${snapshot.messagesPerSecond}`);
    console.log();
  }
}

export const metrics = new Metrics();
