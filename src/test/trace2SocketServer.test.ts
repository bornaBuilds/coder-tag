import * as assert from "node:assert";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { NodeTrace2SocketServer } from "../git/trace2SocketServer";

suite("NodeTrace2SocketServer", () => {
  test("receives data through a private socket and removes it on stop", async () => {
    let received = "";
    let ended = false;
    let resolveData: (() => void) | undefined;
    const dataReceived = new Promise<void>((resolve) => {
      resolveData = resolve;
    });
    const server = new NodeTrace2SocketServer({
      onData: (_streamId, chunk) => {
        received += chunk.toString();
        resolveData?.();
      },
      onEnd: () => {
        ended = true;
      },
    });

    const socketPath = await server.start();
    const directoryPath = path.dirname(socketPath);
    const directoryMode = (await fs.stat(directoryPath)).mode & 0o777;
    const socketMode = (await fs.stat(socketPath)).mode & 0o777;

    assert.strictEqual(directoryMode, 0o700);
    assert.strictEqual(socketMode, 0o600);

    const client = net.createConnection(socketPath);
    await once(client, "connect");
    client.end("trace-data\n");
    await dataReceived;
    await once(client, "close");

    assert.strictEqual(received, "trace-data\n");
    assert.strictEqual(ended, true);

    await server.stop();
    await assert.rejects(fs.access(directoryPath));
  });
});
