import * as assert from "node:assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  CompositePushDetector,
  HookPushDetector,
  PushDetector,
  PushEvent,
  pushEventFileExtension,
} from "../git/pushDetector";

class FakePushDetector implements PushDetector {
  private readonly emitter = new vscode.EventEmitter<PushEvent>();

  public readonly onDidPush = this.emitter.event;

  public async start(): Promise<void> {}
  public stop(): void {}
  public dispose(): void {
    this.emitter.dispose();
  }

  public fire(event: PushEvent): void {
    this.emitter.fire(event);
  }
}

async function waitForFileRemoval(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.fail(`Event file was not removed: ${filePath}`);
}

suite("Push detectors", () => {
  test("turns a recent hook event file into one PushEvent", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "coder-tag-events-"),
    );
    const repositoryRoot = path.join(directory, "repository");
    const detector = new HookPushDetector(directory);

    try {
      await detector.start();
      const receivedEvent = new Promise<PushEvent>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for hook event")),
          5_000,
        );
        const subscription = detector.onDidPush((event) => {
          clearTimeout(timeout);
          subscription.dispose();
          resolve(event);
        });
      });
      const temporaryPath = path.join(directory, "push.tmp");
      const eventPath = path.join(
        directory,
        `push${pushEventFileExtension}`,
      );
      await fs.writeFile(temporaryPath, `${repositoryRoot}\n`, "utf8");
      await fs.rename(temporaryPath, eventPath);

      const event = await receivedEvent;
      assert.strictEqual(event.source, "git-hook");
      assert.strictEqual(event.repositoryRoot, path.resolve(repositoryRoot));
      await waitForFileRemoval(eventPath);
    } finally {
      detector.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test("deduplicates hook and publish events for one repository", async () => {
    const hookDetector = new FakePushDetector();
    const publishDetector = new FakePushDetector();
    const detector = new CompositePushDetector(
      [hookDetector, publishDetector],
      1_500,
    );
    const events: PushEvent[] = [];

    try {
      detector.onDidPush((event) => events.push(event));
      await detector.start();
      const repositoryRoot = path.join(os.tmpdir(), "coder-tag-repository");

      hookDetector.fire({
        source: "git-hook",
        timestamp: Date.now(),
        repositoryRoot,
      });
      publishDetector.fire({
        source: "git-publish",
        timestamp: Date.now(),
        repositoryRoot,
      });

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].source, "git-hook");
    } finally {
      detector.dispose();
    }
  });
});
