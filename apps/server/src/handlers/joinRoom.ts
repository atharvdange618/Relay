import { Connection } from "../../../../packages/transport/src/connection/connection.js";
import { MessageType } from "../../../../packages/protocol/src/constants.js";
import type { ParsedFrame } from "../../../../packages/protocol/src/types.js";
import { RoomManager } from "../rooms/roomManager.js";
import { metrics } from "../observability/metrics.js";

/**
 * Handle JOIN_ROOM message
 *
 * Client requests to join a specific room.
 */
export function handleJoinRoom(
  connection: Connection,
  frame: ParsedFrame,
  roomManager: RoomManager
): void {
  const payload = frame.payload as { room: string };

  if (!payload.room || typeof payload.room !== "string") {
    connection.send(MessageType.ERROR, {
      error: "Invalid room name",
    });
    return;
  }

  const roomName = payload.room.trim();

  if (roomName.length === 0 || roomName.length > 64) {
    connection.send(MessageType.ERROR, {
      error: "Room name must be 1-64 characters",
    });
    return;
  }

  // Join the room
  roomManager.joinRoom(connection, roomName);
  metrics.setRoomCount(roomManager.getRoomCount());

  // Send confirmation
  connection.send(MessageType.JOIN_ROOM, {
    status: "joined",
    room: roomName,
  });
}
