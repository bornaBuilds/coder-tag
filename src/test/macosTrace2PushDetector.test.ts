import * as assert from "node:assert";
import * as vscode from "vscode";
import { GitManager } from "../git/gitManager";
import {
  MacosTrace2PushDetector,
} from "../git/macosTrace2PushDetector";
import { PushEvent } from "../git/pushDetector";
import {
  Trace2StreamHandlers,
  Trace2StreamServer,
} from "../git/trace2SocketServer";

interface Replacement {
  readonly variable: string;
  readonly value: string;
  readonly options?: vscode.EnvironmentVariableMutatorOptions;
}

class FakeEnvironmentCollection {
  public persistent = true;
  public description: string | vscode.MarkdownString | undefined;
  public readonly replacements: Replacement[] = [];
  public readonly deletions: string[] = [];

  public replace(
    variable: string,
    value: string,
    options?: vscode.EnvironmentVariableMutatorOptions,
  ): void {
    this.replacements.push({ variable, value, options });
  }

  public delete(variable: string): void {
    this.deletions.push(variable);
  }
}

class FakeServer implements Trace2StreamServer {
  public starts = 0;
  public stops = 0;

  constructor(
    public readonly handlers: Trace2StreamHandlers,
    private readonly path = "/tmp/coder-tag-test/trace2.sock",
  ) {}

  public start(): Promise<string> {
    this.starts += 1;
    return Promise.resolve(this.path);
  }

  public stop(): Promise<void> {
    this.stops += 1;
    return Promise.resolve();
  }
}

function traceEvent(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail("Timed out waiting for an asynchronous detector update.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

suite("MacosTrace2PushDetector", () => {
  test("injects a non-persistent Trace2 target and emits successful pushes", async () => {
    const environment = new FakeEnvironmentCollection();
    let server: FakeServer | undefined;
    const gitManager = {
      resolveRepositoryRoot(uri: vscode.Uri) {
        assert.strictEqual(uri.fsPath, "/repo");
        return "/canonical-repo";
      },
    } as GitManager;
    const detector = new MacosTrace2PushDetector(
      environment as unknown as vscode.GlobalEnvironmentVariableCollection,
      gitManager,
      {
        platform: "darwin",
        hasExistingTraceTarget: () => false,
        createServer: (handlers) => {
          server = new FakeServer(handlers);
          return server;
        },
      },
    );
    const events: PushEvent[] = [];
    detector.onDidPush((event) => events.push(event));

    await detector.start();

    assert.strictEqual(environment.persistent, false);
    assert.strictEqual(server?.starts, 1);
    assert.deepStrictEqual(environment.replacements, [{
      variable: "GIT_TRACE2_EVENT",
      value: "af_unix:stream:/tmp/coder-tag-test/trace2.sock",
      options: {
        applyAtProcessCreation: true,
        applyAtShellIntegration: false,
      },
    }]);

    server?.handlers.onData("git", Buffer.from(
      traceEvent({
        event: "start",
        sid: "push",
        argv: ["git", "push"],
      }) +
      traceEvent({
        event: "def_repo",
        sid: "push",
        worktree: "/repo",
      }) +
      traceEvent({
        event: "exit",
        sid: "push",
        code: 0,
      }),
    ));

    assert.deepStrictEqual(events, [{
      source: "terminal-trace2",
      timestamp: events[0].timestamp,
      repositoryRoot: "/canonical-repo",
      repositoryRootIsExact: true,
    }]);

    await detector.shutdown();
    assert.strictEqual(server?.stops, 1);
    detector.dispose();
  });

  test("does nothing on non-macOS platforms", async () => {
    const environment = new FakeEnvironmentCollection();
    let factoryCalls = 0;
    const detector = new MacosTrace2PushDetector(
      environment as unknown as vscode.GlobalEnvironmentVariableCollection,
      undefined,
      {
        platform: "linux",
        createServer: (handlers) => {
          factoryCalls += 1;
          return new FakeServer(handlers);
        },
      },
    );

    await detector.start();

    assert.strictEqual(factoryCalls, 0);
    assert.deepStrictEqual(environment.replacements, []);
    detector.dispose();
  });

  test("preserves an existing Trace2 target", async () => {
    const environment = new FakeEnvironmentCollection();
    let factoryCalls = 0;
    const originalWarn = console.warn;
    const originalTarget = process.env.GIT_TRACE2_EVENT;
    process.env.GIT_TRACE2_EVENT = "/existing/trace-target";
    console.warn = () => undefined;

    try {
      const detector = new MacosTrace2PushDetector(
        environment as unknown as vscode.GlobalEnvironmentVariableCollection,
        undefined,
        {
          platform: "darwin",
          createServer: (handlers) => {
            factoryCalls += 1;
            return new FakeServer(handlers);
          },
        },
      );

      await detector.start();

      assert.strictEqual(factoryCalls, 0);
      assert.deepStrictEqual(environment.replacements, []);
      detector.dispose();
    } finally {
      console.warn = originalWarn;
      if (originalTarget === undefined) {
        delete process.env.GIT_TRACE2_EVENT;
      } else {
        process.env.GIT_TRACE2_EVENT = originalTarget;
      }
    }
  });

  test("starts and stops dynamically when the setting changes", async () => {
    const environment = new FakeEnvironmentCollection();
    const settingEmitter = new vscode.EventEmitter<void>();
    let enabled = false;
    let server: FakeServer | undefined;
    const detector = new MacosTrace2PushDetector(
      environment as unknown as vscode.GlobalEnvironmentVariableCollection,
      undefined,
      {
        platform: "darwin",
        isEnabled: () => enabled,
        onDidChangeEnabled: settingEmitter.event,
        hasExistingTraceTarget: () => false,
        createServer: (handlers) => {
          server = new FakeServer(handlers);
          return server;
        },
      },
    );

    await detector.start();
    assert.strictEqual(server, undefined);

    enabled = true;
    settingEmitter.fire();
    await waitFor(() => environment.replacements.length === 1);

    enabled = false;
    settingEmitter.fire();
    await waitFor(() => server?.stops === 1);
    assert.ok(environment.deletions.includes("GIT_TRACE2_EVENT"));

    detector.dispose();
    settingEmitter.dispose();
  });
});
