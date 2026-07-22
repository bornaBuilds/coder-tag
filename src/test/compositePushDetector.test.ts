import * as assert from "node:assert";
import * as vscode from "vscode";
import { CompositePushDetector } from "../git/compositePushDetector";
import { PushDetector, PushEvent } from "../git/pushDetector";

class FakeDetector implements PushDetector, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<PushEvent>();
  public started = false;
  public stopped = false;
  public readonly onDidPush = this.emitter.event;

  public async start(): Promise<void> {
    this.started = true;
  }

  public stop(): void {
    this.stopped = true;
  }

  public emit(event: PushEvent): void {
    this.emitter.fire(event);
  }

  public dispose(): void {
    this.emitter.dispose();
  }
}

function pushEvent(repositoryRoot: string | undefined): PushEvent {
  return { source: "git-operation", timestamp: 0, repositoryRoot };
}

suite("CompositePushDetector", () => {
  test("starts every child and forwards their events", async () => {
    const first = new FakeDetector();
    const second = new FakeDetector();
    const composite = new CompositePushDetector([first, second]);
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    assert.ok(first.started && second.started);

    first.emit(pushEvent("/a"));
    second.emit(pushEvent("/b"));
    assert.strictEqual(events.length, 2);

    composite.dispose();
    assert.ok(first.stopped && second.stopped);
  });

  test("suppresses duplicate events for the same repo within the window", async () => {
    let clock = 1000;
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      dedupeWindowMs: 1500,
      now: () => clock,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();

    child.emit(pushEvent("/repo"));
    clock += 500; // within the window
    child.emit(pushEvent("/repo"));
    assert.strictEqual(events.length, 1);

    clock += 2000; // past the window
    child.emit(pushEvent("/repo"));
    assert.strictEqual(events.length, 2);

    composite.dispose();
  });

  test("does not collapse events from different repositories", async () => {
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      now: () => 0,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    child.emit(pushEvent("/a"));
    child.emit(pushEvent("/b"));
    assert.strictEqual(events.length, 2);

    composite.dispose();
  });
});
