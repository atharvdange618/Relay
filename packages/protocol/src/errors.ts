/**
 * Protocol Error Classes
 */

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export class InvalidFrameError extends ProtocolError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFrameError";
  }
}

export class UnsupportedVersionError extends ProtocolError {
  constructor(version: number) {
    super(`Unsupported protocol version: ${version}`);
    this.name = "UnsupportedVersionError";
  }
}
