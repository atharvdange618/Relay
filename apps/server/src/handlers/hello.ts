import { Connection } from "../../../../packages/transport/src/connection/connection.js";
import { MessageType } from "../../../../packages/protocol/src/constants.js";
import type { ParsedFrame } from "../../../../packages/protocol/src/types.js";

/**
 * Handle HELLO message
 *
 * Client sends HELLO to identify itself.
 * Server responds with acknowledgment.
 */
export function handleHello(connection: Connection, _frame: ParsedFrame): void {
  // Send ACK back
  connection.send(MessageType.HELLO, {
    status: "connected",
    connectionId: connection.connectionId,
    serverVersion: "1.0.0",
  });
}
