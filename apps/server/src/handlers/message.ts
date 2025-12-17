import { Connection } from "../../../../packages/transport/src/connection/connection.js";
import { MessageType } from "../../../../packages/protocol/src/constants.js";
import type { ParsedFrame } from "../../../../packages/protocol/src/types.js";
import { RoomManager } from "../rooms/roomManager.js";

/**
 * Handle MESSAGE
 *
 * Client sends a message to a room.
 * Server broadcasts it to all other members.
 */
export function handleMessage(
  connection: Connection,
  frame: ParsedFrame,
  roomManager: RoomManager
): void {
  const payload = frame.payload as { room: string; content: unknown };

  if (!payload.room || typeof payload.room !== "string") {
    connection.send(MessageType.ERROR, {
      error: "Room name required",
    });
    return;
  }

  if (payload.content === undefined) {
    connection.send(MessageType.ERROR, {
      error: "Message content required",
    });
    return;
  }

  const roomName = payload.room.trim();
  const room = roomManager.getRoom(roomName);

  if (!room) {
    connection.send(MessageType.ERROR, {
      error: `Room '${roomName}' does not exist`,
    });
    return;
  }

  if (!room.hasMember(connection.connectionId)) {
    connection.send(MessageType.ERROR, {
      error: `You are not in room '${roomName}'`,
    });
    return;
  }

  // Broadcast to room (excluding sender)
  roomManager.broadcastToRoom(
    roomName,
    {
      room: roomName,
      from: connection.connectionId,
      content: payload.content,
      timestamp: Date.now(),
    },
    connection.connectionId
  );

  console.log(`[${connection.connectionId}] Message to room ${roomName}`);
}
