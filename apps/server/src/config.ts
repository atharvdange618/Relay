/**
 * Server configuration
 */

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  host: process.env.HOST || "0.0.0.0",
  debug: process.env.RELAY_DEBUG === "1",
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || "30000", 10),
};
