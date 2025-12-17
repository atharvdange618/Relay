import { Socket } from "net";
import { Connection } from "./connection.js";
import { EventEmitter } from "events";

/**
 * ConnectionManager tracks all active connections.
 *
 * Responsibilities:
 * - Assign unique connection IDs
 * - Track active connections
 * - Handle connection cleanup
 * - Provide connection lookup
 */
export class ConnectionManager extends EventEmitter {
  private connections: Map<string, Connection> = new Map();
  private nextId: number = 1;

  /**
   * Create a new connection from a socket
   */
  createConnection(socket: Socket): Connection {
    const connectionId = this.generateId();
    const connection = new Connection(socket, connectionId);

    this.connections.set(connectionId, connection);

    // Wire up cleanup
    connection.on("close", () => {
      this.connections.delete(connectionId);
      this.emit("connectionClosed", connectionId);
    });

    this.emit("connectionCreated", connection);

    return connection;
  }

  /**
   * Get a connection by ID
   */
  getConnection(connectionId: string): Connection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all active connections
   */
  getAllConnections(): Connection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.close();
    }
  }

  /**
   * Generate a unique connection ID
   */
  private generateId(): string {
    return `conn-${this.nextId++}`;
  }
}
