import { Room } from "./room.js";
import { Connection } from "../../../../packages/transport/src/connection/connection.js";

/**
 * RoomManager manages all rooms in the system.
 *
 * Responsibilities:
 * - Create and destroy rooms
 * - Track which connections are in which rooms
 * - Cleanup empty rooms
 */
export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private connectionRooms: Map<string, Set<string>> = new Map(); // connectionId -> Set<roomName>

  /**
   * Join a connection to a room (creates room if it doesn't exist)
   */
  joinRoom(connection: Connection, roomName: string): void {
    // Get or create room
    let room = this.rooms.get(roomName);
    if (!room) {
      room = new Room(roomName);
      this.rooms.set(roomName, room);
    }

    // Add connection to room
    room.join(connection);

    // Track connection's rooms
    if (!this.connectionRooms.has(connection.connectionId)) {
      this.connectionRooms.set(connection.connectionId, new Set());
    }
    this.connectionRooms.get(connection.connectionId)!.add(roomName);
  }

  /**
   * Remove a connection from a room
   */
  leaveRoom(connectionId: string, roomName: string): void {
    const room = this.rooms.get(roomName);
    if (!room) return;

    room.leave(connectionId);

    // Update tracking
    const connRooms = this.connectionRooms.get(connectionId);
    if (connRooms) {
      connRooms.delete(roomName);
      if (connRooms.size === 0) {
        this.connectionRooms.delete(connectionId);
      }
    }

    // Cleanup empty room
    if (room.isEmpty()) {
      this.rooms.delete(roomName);
    }
  }

  /**
   * Remove a connection from all rooms (typically on disconnect)
   */
  leaveAllRooms(connectionId: string): void {
    const connRooms = this.connectionRooms.get(connectionId);
    if (!connRooms) return;

    // Leave each room
    for (const roomName of connRooms) {
      this.leaveRoom(connectionId, roomName);
    }
  }

  /**
   * Broadcast a message to a room
   */
  broadcastToRoom(
    roomName: string,
    payload: unknown,
    excludeConnectionId?: string
  ): void {
    const room = this.rooms.get(roomName);
    if (room) {
      room.broadcast(payload, excludeConnectionId);
    }
  }

  /**
   * Get a room by name
   */
  getRoom(roomName: string): Room | undefined {
    return this.rooms.get(roomName);
  }

  /**
   * Get all rooms a connection is in
   */
  getConnectionRooms(connectionId: string): string[] {
    const rooms = this.connectionRooms.get(connectionId);
    return rooms ? Array.from(rooms) : [];
  }

  /**
   * Get room count
   */
  getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get all room names
   */
  getAllRoomNames(): string[] {
    return Array.from(this.rooms.keys());
  }
}
