import * as assert from "node:assert";
import * as vscode from "vscode";
import { CompositePushDetector } from "../git/compositePushDetector";
import {
  PushDetector,
  PushEvent,
  PushEventSource,
} from "../git/pushDetector";

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

function pushEvent(
  repositoryRoot: string | undefined,
  source: PushEventSource = "git-operation",
  repositoryRootIsExact = true,
): PushEvent {
  return {
    source,
    timestamp: 0,
    repositoryRoot,
    repositoryRootIsExact,
  };
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

  test("suppresses known cross-source pairs one-to-one", async () => {
    let clock = 1000;
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      dedupeWindowMs: 1500,
      now: () => clock,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();

    child.emit(pushEvent("/repo", "terminal"));
    clock += 100;
    child.emit(pushEvent("/repo", "terminal"));
    clock += 100;
    child.emit(pushEvent("/repo", "terminal-trace2"));
    clock += 100;
    child.emit(pushEvent("/repo", "terminal-trace2"));
    assert.strictEqual(events.length, 2);

    child.emit(pushEvent("/published", "git-operation"));
    child.emit(pushEvent("/published", "git-publish"));
    assert.strictEqual(events.length, 3);

    composite.dispose();
  });

  test("preserves repeated events from the same source", async () => {
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      now: () => 0,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    child.emit(pushEvent("/repo", "terminal"));
    child.emit(pushEvent("/repo", "terminal"));

    assert.strictEqual(events.length, 2);
    composite.dispose();
  });

  test("matches a terminal subdirectory with its Trace2 repository root", async () => {
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      now: () => 0,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    child.emit(pushEvent("/repo/packages/app", "terminal", false));
    child.emit(pushEvent("/repo", "terminal-trace2"));

    assert.strictEqual(events.length, 1);
    composite.dispose();
  });

  test("does not pair terminal signals from unrelated repositories", async () => {
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      now: () => 0,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    child.emit(pushEvent("/repo-a", "terminal"));
    child.emit(pushEvent("/repo-b", "terminal-trace2"));

    assert.strictEqual(events.length, 2);
    composite.dispose();
  });

  test("does not collapse exact roots for nested repositories", async () => {
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      now: () => 0,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    child.emit(pushEvent("/repo", "terminal", true));
    child.emit(pushEvent("/repo/nested", "terminal-trace2", true));

    assert.strictEqual(events.length, 2);
    composite.dispose();
  });

  test("does not suppress counterparts outside the window", async () => {
    let clock = 0;
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      dedupeWindowMs: 1500,
      now: () => clock,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    child.emit(pushEvent("/repo", "terminal"));
    clock += 1500;
    child.emit(pushEvent("/repo", "terminal-trace2"));

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

  test("does not collapse events with unknown repositories", async () => {
    const child = new FakeDetector();
    const composite = new CompositePushDetector([child], {
      now: () => 0,
    });
    const events: PushEvent[] = [];
    composite.onDidPush((event) => events.push(event));

    await composite.start();
    child.emit(pushEvent(undefined, "terminal"));
    child.emit(pushEvent(undefined, "terminal-trace2"));

    assert.strictEqual(events.length, 2);
    composite.dispose();
  });
});
