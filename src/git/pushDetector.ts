import * as vscode from "vscode";
import { GitManager } from "./gitManager";

export type PushEventSource = "git-publish" | "manual";

/**
 * A normalized event consumed by PushHandler, regardless of where the event
 * originated.
 */
export interface PushEvent {
  readonly source: PushEventSource;
  readonly timestamp: number;
  readonly repositoryRoot?: string;
  readonly branch?: string;
}

/**
 * Abstraction for current and future reliable push-detection strategies.
 */
export interface PushDetector {
  start(): Promise<void>;
  stop(): void;
  onDidPush(listener: (event: PushEvent) => void): vscode.Disposable;
}

/**
 * Detects the verified `onDidPublish` event exposed by VS Code's public Git
 * API. This covers publishing a repository or branch for the first time. The
 * public API does not expose ordinary successful `git push` operations.
 */
export class GitPublishPushDetector implements PushDetector, vscode.Disposable {
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private publishSubscription: vscode.Disposable | undefined;
  private started = false;

  constructor(private readonly gitManager: GitManager) {}

  public readonly onDidPush = this.pushEmitter.event;

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    const gitAPI = await this.gitManager.initialize();

    if (!gitAPI) {
      return;
    }

    this.publishSubscription = gitAPI.onDidPublish((event) => {
      this.pushEmitter.fire({
        source: "git-publish",
        timestamp: Date.now(),
        repositoryRoot: event.repository.rootUri.fsPath,
        branch: event.branch,
      });
    });
  }

  public stop(): void {
    this.publishSubscription?.dispose();
    this.publishSubscription = undefined;
    this.started = false;
  }

  public dispose(): void {
    this.stop();
    this.pushEmitter.dispose();
  }
}
