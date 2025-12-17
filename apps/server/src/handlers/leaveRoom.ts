import { Connection } from "../../../../packages/transport/src/connection/connection.js";
import { MessageType } from "../../../../packages/protocol/src/constants.js";
import type { ParsedFrame } from "../../../../packages/protocol/src/types.js";
import { RoomManager } from "../rooms/roomManager.js";

/**
 * Handle LEAVE_ROOM message
 *
 * Client requests to leave a specific room.
 */
export function handleLeaveRoom(
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

  // Leave the room
  roomManager.leaveRoom(connection.connectionId, roomName);

  // Send confirmation
  connection.send(MessageType.LEAVE_ROOM, {
    status: "left",
    room: roomName,
  });

  console.log(`[${connection.connectionId}] Left room: ${roomName}`);
}
