import { RelayClient } from "./client.js";
import { MessageType } from "../../../packages/protocol/src/constants.js";
import type { ParsedFrame } from "../../../packages/protocol/src/types.js";
import * as readline from "readline";

/**
 * CLI for Relay client
 */
export class RelayCLI {
  private client: RelayClient;
  private rl: readline.Interface;
  private currentRoom: string | null = null;

  constructor() {
    this.client = new RelayClient();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "relay> ",
    });

    this.wireClient();
    this.wireReadline();
  }

  /**
   * Wire client events
   */
  private wireClient(): void {
    this.client.on("connected", () => {
      console.log("Connected to Relay server");
      this.client.hello("cli-user");
    });

    this.client.on("disconnected", () => {
      console.log("Disconnected from server");
      this.rl.close();
      process.exit(0);
    });

    this.client.on("frame", (frame: ParsedFrame) => {
      this.handleFrame(frame);
    });

    this.client.on("error", (err: Error) => {
      console.error("Error:", err.message);
    });
  }

  /**
   * Handle incoming frame
   */
  private handleFrame(frame: ParsedFrame): void {
    const typeName = MessageType[frame.type];

    switch (frame.type) {
      case MessageType.HELLO:
        console.log(`🤝 Server says:`, frame.payload);
        break;

      case MessageType.JOIN_ROOM:
        console.log(`✅ Joined room:`, frame.payload);
        break;

      case MessageType.LEAVE_ROOM:
        console.log(`👋 Left room:`, frame.payload);
        break;

      case MessageType.MESSAGE:
        this.displayMessage(frame.payload);
        break;

      case MessageType.ERROR:
        console.log(` Error:`, frame.payload);
        break;

      default:
        console.log(`📦 [${typeName}]`, frame.payload);
    }

    this.rl.prompt();
  }

  /**
   * Display incoming message
   */
  private displayMessage(payload: unknown): void {
    const msg = payload as {
      type?: string;
      room: string;
      from?: string;
      content?: string;
      timestamp?: number;
      connectionId?: string;
    };

    // Handle room notifications (userJoined, userLeft)
    if (msg.type === "userJoined") {
      console.log(`\n✅ [${msg.room}] ${msg.connectionId} joined the room`);
      return;
    }

    if (msg.type === "userLeft") {
      console.log(`\n👋 [${msg.room}] ${msg.connectionId} left the room`);
      return;
    }

    // Handle regular messages
    if (msg.from && msg.content !== undefined && msg.timestamp) {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      console.log(`\n[${msg.room}] ${msg.from} (${time}): ${msg.content}`);
    } else {
      // Fallback for unexpected message format
      console.log(`\n[${msg.room}]`, msg);
    }
  }

  /**
   * Wire readline
   */
  private wireReadline(): void {
    this.rl.on("line", (input: string) => {
      const trimmed = input.trim();
      if (trimmed) {
        this.handleCommand(trimmed);
      }
      this.rl.prompt();
    });

    this.rl.on("close", () => {
      console.log("\nGoodbye!");
      this.client.disconnect();
      process.exit(0);
    });
  }

  /**
   * Handle CLI command
   */
  private handleCommand(input: string): void {
    const parts = input.split(" ");
    const command = parts[0];
    const args = parts.slice(1);

    try {
      switch (command) {
        case "join":
          if (args.length === 0) {
            console.log("Usage: join <room-name>");
          } else {
            const room = args[0]!;
            this.client.joinRoom(room);
            this.currentRoom = room;
          }
          break;

        case "leave":
          if (args.length === 0) {
            console.log("Usage: leave <room-name>");
          } else {
            const room = args[0]!;
            this.client.leaveRoom(room);
            if (this.currentRoom === room) {
              this.currentRoom = null;
            }
          }
          break;

        case "send":
          if (!this.currentRoom) {
            console.log(" You must join a room first");
          } else if (args.length === 0) {
            console.log("Usage: send <message>");
          } else {
            const message = args.join(" ");
            this.client.sendMessage(this.currentRoom, message);
          }
          break;

        case "heartbeat":
          this.client.heartbeat();
          console.log("❤️  Heartbeat sent");
          break;

        case "quit":
        case "exit":
          this.rl.close();
          break;

        case "help":
          this.showHelp();
          break;

        default:
          console.log(
            `Unknown command: ${command}. Type 'help' for available commands.`
          );
      }
    } catch (err) {
      console.error(" Command failed:", err);
    }
  }

  /**
   * Show help
   */
  private showHelp(): void {
    console.log(`
Available commands:
  join <room>       - Join a room
  leave <room>      - Leave a room
  send <message>    - Send message to current room
  heartbeat         - Send heartbeat to server
  help              - Show this help
  quit / exit       - Disconnect and exit
`);
  }

  /**
   * Connect and start
   */
  async start(host: string, port: number): Promise<void> {
    console.log(`🔌 Connecting to ${host}:${port}...`);
    await this.client.connect(host, port);
    this.showHelp();
    this.rl.prompt();
  }
}
