import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import * as path from "node:path";

const MAX_MACOS_SOCKET_PATH_BYTES = 103;
const MAX_CONCURRENT_CONNECTIONS = 64;

export interface Trace2StreamHandlers {
  readonly onData: (streamId: string, chunk: Buffer) => void;
  readonly onEnd: (streamId: string) => void;
  readonly onError?: (error: Error) => void;
}

export interface Trace2StreamServer {
  start(): Promise<string>;
  stop(): Promise<void>;
}

export type Trace2StreamServerFactory = (
  handlers: Trace2StreamHandlers,
) => Trace2StreamServer;

export interface NodeTrace2SocketServerOptions {
  readonly baseDirectory?: string;
}

/**
 * Receives Trace2 EVENT data over a private Unix stream socket. Git opens one
 * connection per process, so every connection gets an independent stream ID
 * and line buffer in the parser.
 */
export class NodeTrace2SocketServer implements Trace2StreamServer {
  private server: net.Server | undefined;
  private directoryPath: string | undefined;
  private socketPath: string | undefined;
  private readonly sockets = new Set<net.Socket>();

  constructor(
    private readonly handlers: Trace2StreamHandlers,
    private readonly options?: NodeTrace2SocketServerOptions,
  ) {}

  public async start(): Promise<string> {
    if (this.socketPath) {
      return this.socketPath;
    }

    const baseDirectory = this.options?.baseDirectory ?? "/tmp";
    const directoryPath = await fs.mkdtemp(
      path.join(baseDirectory, "coder-tag-"),
    );
    await fs.chmod(directoryPath, 0o700);

    const socketPath = path.join(directoryPath, "trace2.sock");
    if (Buffer.byteLength(socketPath) > MAX_MACOS_SOCKET_PATH_BYTES) {
      await fs.rm(directoryPath, { recursive: true, force: true });
      throw new Error("The Trace2 Unix socket path is too long.");
    }

    const server = net.createServer((socket) => this.accept(socket));
    this.directoryPath = directoryPath;
    this.socketPath = socketPath;
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        const handleStartupError = (error: Error): void => {
          reject(error);
        };

        server.once("error", handleStartupError);
        server.listen(socketPath, () => {
          server.off("error", handleStartupError);
          resolve();
        });
      });

      server.on("error", (error) => this.handlers.onError?.(error));
      server.unref();
      await fs.chmod(socketPath, 0o600);
      return socketPath;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    const server = this.server;
    const directoryPath = this.directoryPath;

    this.server = undefined;
    this.directoryPath = undefined;
    this.socketPath = undefined;

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (server) {
      await new Promise<void>((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    if (directoryPath) {
      await fs.rm(directoryPath, { recursive: true, force: true });
    }
  }

  private accept(socket: net.Socket): void {
    if (this.sockets.size >= MAX_CONCURRENT_CONNECTIONS) {
      socket.destroy();
      return;
    }

    const streamId = randomUUID();
    let ended = false;

    const handleEnd = (): void => {
      if (ended) {
        return;
      }

      ended = true;
      this.sockets.delete(socket);
      this.handlers.onEnd(streamId);
    };

    this.sockets.add(socket);
    socket.on("data", (chunk: Buffer) => {
      this.handlers.onData(streamId, chunk);
    });
    socket.on("close", handleEnd);
    socket.on("error", (error) => {
      this.handlers.onError?.(error);
      handleEnd();
    });
  }
}

export const createTrace2SocketServer: Trace2StreamServerFactory = (
  handlers,
) => new NodeTrace2SocketServer(handlers);
