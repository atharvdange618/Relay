import { createServer, Server as NetServer } from "net";
import { ConnectionManager } from "../../../packages/transport/src/connection/connectionManager.js";
import { RoomManager } from "./rooms/roomManager.js";
import { MessageType } from "../../../packages/protocol/src/constants.js";
import { handleHello } from "./handlers/hello.js";
import { handleJoinRoom } from "./handlers/joinRoom.js";
import { handleLeaveRoom } from "./handlers/leaveRoom.js";
import { handleMessage } from "./handlers/message.js";
import type { ParsedFrame } from "../../../packages/protocol/src/types.js";
import { Connection } from "../../../packages/transport/src/connection/connection.js";
import { config } from "./config.js";

/**
 * Relay TCP Server
 *
 * Core responsibilities:
 * - Accept TCP connections
 * - Wire up Connection instances
 * - Route frames to appropriate handlers
 * - Manage rooms and broadcasting
 */
export class RelayServer {
  private server: NetServer;
  private connectionManager: ConnectionManager;
  private roomManager: RoomManager;

  constructor() {
    this.connectionManager = new ConnectionManager();
    this.roomManager = new RoomManager();
    this.server = createServer((socket) => this.handleSocket(socket));
  }

  /**
   * Start the server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(config.port, config.host, () => {
        console.log(`Relay server listening on ${config.host}:${config.port}`);
        if (config.debug) {
          console.log("Debug mode enabled (RELAY_DEBUG=1)");
        }
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log("Shutting down Relay server...");

      // Close all connections
      this.connectionManager.closeAll();

      // Close server
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log("Server stopped");
          resolve();
        }
      });
    });
  }

  /**
   * Handle new socket connection
   */
  private handleSocket(socket: import("net").Socket): void {
    // Create Connection wrapper
    const connection = this.connectionManager.createConnection(socket);

    if (config.debug) {
      console.log(
        `[${connection.connectionId}] New connection from ${socket.remoteAddress}`
      );
    }

    // Wire up frame handler
    connection.on("frame", (frame: ParsedFrame) => {
      this.handleFrame(connection, frame);
    });

    // Handle errors
    connection.on("error", (error) => {
      console.error(`[${connection.connectionId}] Error:`, error.reason);
    });

    // Handle close
    connection.on("close", (stats) => {
      if (config.debug) {
        console.log(
          `[${connection.connectionId}] Closed. Sent: ${stats.bytesSent}B, Received: ${stats.bytesReceived}B`
        );
      }

      // Clean up rooms
      this.roomManager.leaveAllRooms(connection.connectionId);
    });

    // Handle heartbeat
    connection.on("heartbeat", () => {
      if (config.debug) {
        console.log(`[${connection.connectionId}] ❤️  Heartbeat received`);
      }
    });
  }

  /**
   * Route frame to appropriate handler
   */
  private handleFrame(connection: Connection, frame: ParsedFrame): void {
    if (config.debug) {
      console.log(
        `[${connection.connectionId}] Frame type: ${MessageType[frame.type]}`
      );
    }

    try {
      switch (frame.type) {
        case MessageType.HELLO:
          handleHello(connection, frame);
          break;

        case MessageType.JOIN_ROOM:
          handleJoinRoom(connection, frame, this.roomManager);
          break;

        case MessageType.LEAVE_ROOM:
          handleLeaveRoom(connection, frame, this.roomManager);
          break;

        case MessageType.MESSAGE:
          handleMessage(connection, frame, this.roomManager);
          break;

        case MessageType.HEARTBEAT:
          break;

        default:
          console.warn(
            `[${connection.connectionId}] Unknown message type: ${frame.type}`
          );
          connection.send(MessageType.ERROR, {
            error: `Unknown message type: ${frame.type}`,
          });
      }
    } catch (err) {
      console.error(`[${connection.connectionId}] Handler error:`, err);
      connection.send(MessageType.ERROR, {
        error: "Internal server error",
      });
    }
  }

  /**
   * Get server stats
   */
  getStats() {
    return {
      connections: this.connectionManager.getConnectionCount(),
      rooms: this.roomManager.getRoomCount(),
    };
  }
}
