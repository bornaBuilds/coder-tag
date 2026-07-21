import { promises as fs, FSWatcher, watch } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { GitManager } from "./gitManager";

export type PushEventSource = "git-publish" | "git-hook" | "manual";
export const pushEventFileExtension = ".coder-tag-push";

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
export interface PushDetector extends vscode.Disposable {
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

/**
 * Converts event files written by Coder Tag's pre-push hook into PushEvents.
 * Event files contain only the repository root path and are deleted after
 * processing.
 */
export class HookPushDetector implements PushDetector {
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private readonly processingFiles = new Set<string>();
  private watcher: FSWatcher | undefined;
  private started = false;

  constructor(
    private readonly eventDirectory: string,
    private readonly maximumEventAgeMs = 10_000,
  ) {}

  public readonly onDidPush = this.pushEmitter.event;

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await fs.mkdir(this.eventDirectory, { recursive: true });
    this.started = true;
    this.watcher = watch(this.eventDirectory, (_eventType, fileName) => {
      if (!fileName) {
        return;
      }

      const name = fileName.toString();

      if (name.endsWith(pushEventFileExtension)) {
        void this.processEventFile(path.join(this.eventDirectory, name));
      }
    });
    this.watcher.on("error", (error) => {
      console.error("Coder Tag: push-event watcher failed.", error);
    });

    for (const fileName of await fs.readdir(this.eventDirectory)) {
      if (fileName.endsWith(pushEventFileExtension)) {
        void this.processEventFile(
          path.join(this.eventDirectory, fileName),
        );
      }
    }
  }

  public stop(): void {
    this.started = false;
    this.watcher?.close();
    this.watcher = undefined;
    this.processingFiles.clear();
  }

  public dispose(): void {
    this.stop();
    this.pushEmitter.dispose();
  }

  private async processEventFile(filePath: string): Promise<void> {
    if (!this.started || this.processingFiles.has(filePath)) {
      return;
    }

    this.processingFiles.add(filePath);

    try {
      const [contents, file] = await Promise.all([
        fs.readFile(filePath, "utf8"),
        fs.stat(filePath),
      ]);
      const repositoryRoot = contents.replace(/[\r\n]+$/, "");
      const isRecent =
        Date.now() - file.mtimeMs <= this.maximumEventAgeMs;

      if (this.started && isRecent && repositoryRoot.length > 0) {
        this.pushEmitter.fire({
          source: "git-hook",
          timestamp: file.mtimeMs,
          repositoryRoot: path.resolve(repositoryRoot),
        });
      }
    } catch (error) {
      if (this.getErrorCode(error) !== "ENOENT") {
        console.error("Coder Tag: could not read a push event.", error);
      }
    } finally {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (this.getErrorCode(error) !== "ENOENT") {
          console.error("Coder Tag: could not remove a push event.", error);
        }
      } finally {
        this.processingFiles.delete(filePath);
      }
    }
  }

  private getErrorCode(error: unknown): string | undefined {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      return error.code;
    }

    return undefined;
  }
}

/**
 * Combines detection strategies and suppresses duplicate real events for the
 * same repository. Test Push calls PushHandler directly and is not deduped.
 */
export class CompositePushDetector implements PushDetector {
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly lastEventByRepository = new Map<string, number>();
  private started = false;

  constructor(
    private readonly detectors: readonly PushDetector[],
    private readonly deduplicationWindowMs = 1_500,
  ) {}

  public readonly onDidPush = this.pushEmitter.event;

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    for (const detector of this.detectors) {
      this.subscriptions.push(
        detector.onDidPush((event) => this.forward(event)),
      );

      try {
        await detector.start();
      } catch (error) {
        console.error("Coder Tag: a push detector could not start.", error);
      }
    }
  }

  public stop(): void {
    this.started = false;

    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }

    for (const detector of this.detectors) {
      detector.stop();
    }

    this.lastEventByRepository.clear();
  }

  public dispose(): void {
    this.stop();

    for (const detector of this.detectors) {
      detector.dispose();
    }

    this.pushEmitter.dispose();
  }

  private forward(event: PushEvent): void {
    if (!this.started || !event.repositoryRoot) {
      return;
    }

    const now = Date.now();
    const repositoryKey =
      process.platform === "win32"
        ? path.resolve(event.repositoryRoot).toLowerCase()
        : path.resolve(event.repositoryRoot);
    const previousTimestamp =
      this.lastEventByRepository.get(repositoryKey) ?? 0;

    if (now - previousTimestamp < this.deduplicationWindowMs) {
      return;
    }

    this.lastEventByRepository.set(repositoryKey, now);

    for (const [key, timestamp] of this.lastEventByRepository) {
      if (now - timestamp >= this.deduplicationWindowMs) {
        this.lastEventByRepository.delete(key);
      }
    }

    this.pushEmitter.fire(event);
  }
}
