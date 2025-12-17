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
import { logger } from "./observability/logger.js";
import { metrics } from "./observability/metrics.js";

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
        logger.info(`Relay server listening on ${config.host}:${config.port}`);
        if (config.debug) {
          logger.info("Debug mode enabled (RELAY_DEBUG=1)");
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
      logger.info("Shutting down Relay server...");

      // Print metrics before shutdown
      metrics.print();

      // Close all connections
      this.connectionManager.closeAll();

      // Close server
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          logger.info("Server stopped");
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

    logger.connection(
      connection.connectionId,
      "Connected",
      { remoteAddress: socket.remoteAddress }
    );

    // Wire up frame handler
    connection.on("frame", (frame: ParsedFrame) => {
      logger.frame(connection.connectionId, "←", frame);
      metrics.messageProcessed();
      this.handleFrame(connection, frame);
    });

    // Handle errors
    connection.on("error", (error) => {
      logger.error(`[${connection.connectionId}] Error: ${error.reason}`, {
        type: error.type,
        fatal: error.fatal,
      });
    });

    // Handle close
    connection.on("close", (stats) => {
      metrics.connectionClosed();
      metrics.bytesSent(stats.bytesSent);
      metrics.bytesReceived(stats.bytesReceived);

      logger.connection(connection.connectionId, "Closed", {
        sent: `${stats.bytesSent}B`,
        received: `${stats.bytesReceived}B`,
      });

      // Clean up rooms
      this.roomManager.leaveAllRooms(connection.connectionId);
      metrics.setRoomCount(this.roomManager.getRoomCount());
    });

    // Handle heartbeat
    connection.on("heartbeat", () => {
      logger.debug(`[${connection.connectionId}] ❤️  Heartbeat received`);
    });
  }

  /**
   * Route frame to appropriate handler
   */
  private handleFrame(connection: Connection, frame: ParsedFrame): void {
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
          logger.warn(
            `[${connection.connectionId}] Unknown message type: ${frame.type}`
          );
          connection.send(MessageType.ERROR, {
            error: `Unknown message type: ${frame.type}`,
          });
      }
    } catch (err) {
      logger.error(`[${connection.connectionId}] Handler error`, err);
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
