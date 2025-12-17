import { Connection } from "../../../../packages/transport/src/connection/connection.js";
import { MessageType } from "../../../../packages/protocol/src/constants.js";
import { logger } from "../observability/logger.js";

/**
 * Room represents a group of connections that can exchange messages.
 *
 * Pure domain logic - no socket or protocol concerns.
 */
export class Room {
  public readonly name: string;
  private members: Map<string, Connection> = new Map();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Add a connection to the room
   */
  join(connection: Connection): void {
    if (this.members.has(connection.connectionId)) {
      return; // Already in room
    }

    this.members.set(connection.connectionId, connection);

    logger.info(
      `[${connection.connectionId}] Joined room '${this.name}' (${this.members.size} members)`
    );

    // Notify others
    this.broadcast(
      {
        type: "userJoined",
        room: this.name,
        connectionId: connection.connectionId,
      },
      connection.connectionId // Exclude the joiner
    );
  }

  /**
   * Remove a connection from the room
   */
  leave(connectionId: string): void {
    const connection = this.members.get(connectionId);
    if (!connection) return;

    this.members.delete(connectionId);

    logger.info(
      `[${connectionId}] Left room '${this.name}' (${this.members.size} members remaining)`
    );

    // Notify others
    this.broadcast({
      type: "userLeft",
      room: this.name,
      connectionId,
    });
  }

  /**
   * Broadcast a message to all members
   *
   * @param payload - Message payload
   * @param excludeConnectionId - Optional connection to exclude
   */
  broadcast(payload: unknown, excludeConnectionId?: string): void {
    let recipientCount = 0;
    for (const [connId, connection] of this.members) {
      if (connId === excludeConnectionId) continue;
      connection.send(MessageType.MESSAGE, payload);
      recipientCount++;
    }

    if (recipientCount > 0) {
      logger.debug(
        `Broadcasting to ${recipientCount} member(s) in '${this.name}'`
      );
    }
  }

  /**
   * Send a message to a specific member
   */
  sendTo(connectionId: string, payload: unknown): void {
    const connection = this.members.get(connectionId);
    if (connection) {
      connection.send(MessageType.MESSAGE, payload);
    }
  }

  /**
   * Check if a connection is in the room
   */
  hasMember(connectionId: string): boolean {
    return this.members.has(connectionId);
  }

  /**
   * Get member count
   */
  getMemberCount(): number {
    return this.members.size;
  }

  /**
   * Get all member IDs
   */
  getMemberIds(): string[] {
    return Array.from(this.members.keys());
  }

  /**
   * Check if room is empty
   */
  isEmpty(): boolean {
    return this.members.size === 0;
  }
}
