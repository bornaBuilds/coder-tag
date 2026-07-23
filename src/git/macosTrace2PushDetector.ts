import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { GitManager } from "./gitManager";
import { PushDetector, PushEvent } from "./pushDetector";
import {
  Trace2EventParser,
  Trace2PushCompletion,
} from "./trace2EventParser";
import {
  createTrace2SocketServer,
  Trace2StreamServer,
  Trace2StreamServerFactory,
} from "./trace2SocketServer";

const TRACE2_EVENT_VARIABLE = "GIT_TRACE2_EVENT";

export interface MacosTrace2PushDetectorOptions {
  readonly platform?: NodeJS.Platform;
  readonly isEnabled?: () => boolean;
  readonly onDidChangeEnabled?: vscode.Event<void>;
  readonly hasExistingTraceTarget?: () => boolean | Promise<boolean>;
  readonly createServer?: Trace2StreamServerFactory;
}

/**
 * macOS fallback for terminals where zsh shell integration displays complete
 * command markers but does not deliver onDidEndTerminalShellExecution.
 *
 * Git reports process lifecycle records to a private Unix socket. Records are
 * parsed in memory and discarded immediately; raw argv is never persisted or
 * logged.
 */
export class MacosTrace2PushDetector
  implements PushDetector, vscode.Disposable
{
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private readonly parser: Trace2EventParser;
  private readonly platform: NodeJS.Platform;
  private readonly isEnabled: () => boolean;
  private readonly hasExistingTraceTarget: () => boolean | Promise<boolean>;
  private readonly createServer: Trace2StreamServerFactory;
  private settingSubscription: vscode.Disposable | undefined;
  private configurationSubscription: vscode.Disposable | undefined;
  private server: Trace2StreamServer | undefined;
  private operation: Promise<void> = Promise.resolve();
  private started = false;
  private shutdownQueued = false;
  private warnedAboutConflict = false;
  private lastEnabled: boolean | undefined;

  constructor(
    private readonly environment: vscode.GlobalEnvironmentVariableCollection,
    private readonly gitManager?: GitManager,
    private readonly options?: MacosTrace2PushDetectorOptions,
  ) {
    this.platform = options?.platform ?? process.platform;
    this.isEnabled = options?.isEnabled ?? (() => true);
    this.hasExistingTraceTarget =
      options?.hasExistingTraceTarget ??
      defaultHasExistingTraceTarget;
    this.createServer = options?.createServer ?? createTrace2SocketServer;
    this.parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => this.handlePush(completion),
    });
  }

  public readonly onDidPush = this.pushEmitter.event;

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.shutdownQueued = false;

    if (this.platform !== "darwin") {
      return;
    }

    this.environment.persistent = false;
    this.environment.description =
      "Enables reliable macOS terminal Git push detection in newly created terminals.";
    this.lastEnabled = this.isEnabled();
    this.settingSubscription = this.options?.onDidChangeEnabled?.(() => {
      const enabled = this.isEnabled();
      if (enabled !== this.lastEnabled) {
        this.lastEnabled = enabled;
        void this.enqueueReconcile();
      }
    });
    this.configurationSubscription =
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("terminal.integrated.env.osx") ||
          event.affectsConfiguration("terminal.integrated.profiles.osx")
        ) {
          void this.enqueueReconcile();
        }
      });

    await this.enqueueReconcile();
  }

  public stop(): void {
    void this.shutdown();
  }

  public async shutdown(): Promise<void> {
    if (!this.shutdownQueued) {
      this.shutdownQueued = true;
      this.started = false;
      this.settingSubscription?.dispose();
      this.settingSubscription = undefined;
      this.configurationSubscription?.dispose();
      this.configurationSubscription = undefined;
      this.lastEnabled = undefined;
      this.environment.delete(TRACE2_EVENT_VARIABLE);
      this.parser.reset();
      await this.enqueue(async () => this.deactivateFallback());
      return;
    }

    await this.operation;
  }

  public dispose(): void {
    this.stop();
    this.pushEmitter.dispose();
  }

  private enqueueReconcile(): Promise<void> {
    return this.enqueue(async () => this.reconcile());
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.operation.then(task, task);
    this.operation = next.catch((error: unknown) => {
      console.error(
        "Coder Tag: macOS terminal fallback failed.",
        error,
      );
    });
    return this.operation;
  }

  private async reconcile(): Promise<void> {
    if (!this.started || !this.isEnabled()) {
      this.environment.delete(TRACE2_EVENT_VARIABLE);
      await this.deactivateFallback();
      return;
    }

    if (await this.hasExistingTraceTarget()) {
      this.environment.delete(TRACE2_EVENT_VARIABLE);
      await this.deactivateFallback();
      if (!this.warnedAboutConflict) {
        console.warn(
          "Coder Tag: macOS terminal fallback is disabled because GIT_TRACE2_EVENT is already configured.",
        );
        this.warnedAboutConflict = true;
      }
      return;
    }
    this.warnedAboutConflict = false;

    if (this.server) {
      return;
    }

    const server = this.createServer({
      onData: (streamId, chunk) => {
        this.parser.acceptChunk(streamId, chunk);
      },
      onEnd: (streamId) => {
        this.parser.endStream(streamId);
      },
      onError: (error) => {
        console.warn(
          "Coder Tag: a macOS Trace2 socket connection failed.",
          error,
        );
      },
    });

    const socketPath = await server.start();
    if (!this.started || !this.isEnabled()) {
      await server.stop();
      return;
    }

    this.server = server;
    this.environment.replace(
      TRACE2_EVENT_VARIABLE,
      `af_unix:stream:${socketPath}`,
      {
        applyAtProcessCreation: true,
        applyAtShellIntegration: false,
      },
    );
  }

  private async deactivateFallback(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.parser.reset();

    if (server) {
      await server.stop();
    }
  }

  private handlePush(completion: Trace2PushCompletion): void {
    if (!this.started || !this.isEnabled()) {
      return;
    }

    const repositoryRoot = completion.repositoryRoot
      ? this.resolveRepositoryRoot(completion.repositoryRoot)
      : undefined;

    this.pushEmitter.fire({
      source: "terminal-trace2",
      timestamp: Date.now(),
      repositoryRoot,
      repositoryRootIsExact: repositoryRoot !== undefined,
    });
  }

  private resolveRepositoryRoot(worktree: string): string {
    const uri = vscode.Uri.file(worktree);
    return this.gitManager?.resolveRepositoryRoot(uri) ?? worktree;
  }
}

async function defaultHasExistingTraceTarget(): Promise<boolean> {
  if (process.env[TRACE2_EVENT_VARIABLE]) {
    return true;
  }

  const terminalEnvironment = vscode.workspace
    .getConfiguration("terminal.integrated")
    .get<Record<string, string | null>>("env.osx");
  if (hasEnvironmentTarget(terminalEnvironment)) {
    return true;
  }

  const terminalProfiles = vscode.workspace
    .getConfiguration("terminal.integrated")
    .get<Record<string, { readonly env?: Record<string, string | null> }>>(
      "profiles.osx",
    );
  if (
    terminalProfiles &&
    Object.values(terminalProfiles).some((profile) =>
      hasEnvironmentTarget(profile?.env)
    )
  ) {
    return true;
  }

  if (hasInjectedGitConfigTarget()) {
    return true;
  }

  const configuredTargets = await Promise.all([
    readGitConfigTarget("--global"),
    readGitConfigTarget("--system"),
  ]);
  return configuredTargets.some(Boolean);
}

function hasEnvironmentTarget(
  environment: Record<string, string | null> | undefined,
): boolean {
  return Boolean(environment?.[TRACE2_EVENT_VARIABLE]);
}

function hasInjectedGitConfigTarget(): boolean {
  const count = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? "0", 10);
  if (!Number.isFinite(count) || count <= 0) {
    return false;
  }

  for (let index = 0; index < count; index += 1) {
    const key = process.env[`GIT_CONFIG_KEY_${index}`];
    const value = process.env[`GIT_CONFIG_VALUE_${index}`];
    if (
      key?.toLowerCase() === "trace2.eventtarget" &&
      typeof value === "string" &&
      value.length > 0
    ) {
      return true;
    }
  }

  return false;
}

function readGitConfigTarget(scope: "--global" | "--system"): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["config", scope, "--get", "trace2.eventTarget"],
      {
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error) {
          resolve(stdout.trim().length > 0);
          return;
        }

        // Exit 1 means the key is absent. Any other failure leaves the
        // destination unknown, so fail closed rather than override it.
        resolve(error.code !== 1);
      },
    );
  });
}
