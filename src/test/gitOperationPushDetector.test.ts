import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  Branch,
  GitModelInternal,
  InternalRepository,
  OperationResult,
} from "../git/gitApi";
import { GitManager } from "../git/gitManager";
import { GitOperationPushDetector } from "../git/gitOperationPushDetector";
import { PushEvent } from "../git/pushDetector";

class FakeRepository implements InternalRepository {
  private readonly operationEmitter = new vscode.EventEmitter<OperationResult>();
  public readonly onDidRunOperation = this.operationEmitter.event;

  constructor(
    public readonly root: string,
    public readonly HEAD: Branch | undefined,
  ) {}

  public emit(result: OperationResult): void {
    this.operationEmitter.fire(result);
  }
}

class FakeModel implements GitModelInternal {
  public readonly openEmitter = new vscode.EventEmitter<InternalRepository>();
  public readonly closeEmitter = new vscode.EventEmitter<InternalRepository>();
  public readonly onDidOpenRepository = this.openEmitter.event;
  public readonly onDidCloseRepository = this.closeEmitter.event;

  constructor(public repositories: InternalRepository[]) {}

  public getRepository(): InternalRepository | undefined {
    return undefined;
  }
}

function createGitManager(model: GitModelInternal | undefined): GitManager {
  return {
    async initialize() {
      return undefined;
    },
    getModel() {
      return model;
    },
  } as unknown as GitManager;
}

function operation(kind: string, error?: unknown): OperationResult {
  return { operation: { kind }, error };
}

suite("GitOperationPushDetector", () => {
  test("fires a git-operation event on a successful push", async () => {
    const repository = new FakeRepository("/repo", { name: "main" });
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([repository])),
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    repository.emit(operation("Push"));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].source, "git-operation");
    assert.strictEqual(events[0].repositoryRoot, "/repo");
    assert.strictEqual(events[0].branch, "main");

    detector.dispose();
  });

  test("ignores failed pushes", async () => {
    const repository = new FakeRepository("/repo", { name: "main" });
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([repository])),
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    repository.emit(operation("Push", new Error("rejected")));

    assert.strictEqual(events.length, 0);
    detector.dispose();
  });

  test("ignores non-push operations, including Sync", async () => {
    const repository = new FakeRepository("/repo", { name: "main" });
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([repository])),
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    for (const kind of ["Sync", "Pull", "Fetch", "Commit"]) {
      repository.emit(operation(kind));
    }

    assert.strictEqual(events.length, 0);
    detector.dispose();
  });

  test("fires on Sync when includeSync returns true", async () => {
    const repository = new FakeRepository("/repo", { name: "main" });
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([repository])),
      { includeSync: () => true },
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    repository.emit(operation("Sync"));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].source, "git-operation");
    assert.strictEqual(events[0].repositoryRoot, "/repo");

    detector.dispose();
  });

  test("ignores Sync when includeSync returns false", async () => {
    const repository = new FakeRepository("/repo", { name: "main" });
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([repository])),
      { includeSync: () => false },
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    repository.emit(operation("Sync"));

    assert.strictEqual(events.length, 0);
    detector.dispose();
  });

  test("ignores a failed Sync even when includeSync is true", async () => {
    const repository = new FakeRepository("/repo", { name: "main" });
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([repository])),
      { includeSync: () => true },
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    repository.emit(operation("Sync", new Error("rejected")));

    assert.strictEqual(events.length, 0);
    detector.dispose();
  });

  test("resolves the base repository when the model returns a wrapper", async () => {
    const base = new FakeRepository("/wrapped", { name: "main" });
    const wrapper = { repository: base } as unknown as InternalRepository;
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([wrapper])),
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    base.emit(operation("Push"));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].repositoryRoot, "/wrapped");
    assert.strictEqual(events[0].branch, "main");

    detector.dispose();
  });

  test("attaches to repositories opened after start", async () => {
    const model = new FakeModel([]);
    const detector = new GitOperationPushDetector(createGitManager(model));
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    const repository = new FakeRepository("/late", { name: "dev" });
    model.openEmitter.fire(repository);
    repository.emit(operation("Push"));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].repositoryRoot, "/late");
    detector.dispose();
  });

  test("stops firing after a repository is closed", async () => {
    const repository = new FakeRepository("/repo", { name: "main" });
    const model = new FakeModel([repository]);
    const detector = new GitOperationPushDetector(createGitManager(model));
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();
    model.closeEmitter.fire(repository);
    repository.emit(operation("Push"));

    assert.strictEqual(events.length, 0);
    detector.dispose();
  });

  test("degrades gracefully when the model is unavailable", async () => {
    const detector = new GitOperationPushDetector(createGitManager(undefined));

    await detector.start();
    detector.dispose();

    assert.ok(true);
  });

  test("does not throw when a repository lacks onDidRunOperation", async () => {
    const repository = {
      root: "/repo",
      HEAD: { name: "main" },
    } as unknown as InternalRepository;
    const detector = new GitOperationPushDetector(
      createGitManager(new FakeModel([repository])),
    );

    await detector.start();
    detector.dispose();

    assert.ok(true);
  });
});
