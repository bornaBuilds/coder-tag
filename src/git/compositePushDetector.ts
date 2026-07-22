import * as vscode from "vscode";
import { PushDetector, PushEvent } from "./pushDetector";

export interface CompositePushDetectorOptions {
  readonly dedupeWindowMs?: number;
  readonly now?: () => number;
}

const DEFAULT_DEDUPE_WINDOW_MS = 1500;
const UNKNOWN_REPOSITORY_KEY = "<unknown>";

/**
 * Fans several push detectors into a single stream and suppresses duplicate
 * events for the same repository within a short window.
 *
 * The one real overlap is a first-time publish, which surfaces as both a
 * "git-operation" Push and a "git-publish" event for the same repository root.
 * Terminal and git-operation events never overlap, because the git extension
 * only emits `onDidRunOperation` for operations it runs itself, not for raw
 * terminal commands.
 */
export class CompositePushDetector implements PushDetector, vscode.Disposable {
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private readonly lastFiredByRepository = new Map<string, number>();
  private childSubscriptions: vscode.Disposable[] = [];
  private readonly dedupeWindowMs: number;
  private readonly now: () => number;
  private started = false;

  constructor(
    private readonly children: PushDetector[],
    options?: CompositePushDetectorOptions,
  ) {
    this.dedupeWindowMs = options?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.now = options?.now ?? Date.now;
  }

  public readonly onDidPush = this.pushEmitter.event;

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    // Subscribe before starting so no event emitted during a child's start()
    // is missed.
    this.childSubscriptions = this.children.map((child) =>
      child.onDidPush((event) => this.handleChildPush(event)),
    );

    await Promise.all(this.children.map((child) => child.start()));
  }

  private handleChildPush(event: PushEvent): void {
    const key = event.repositoryRoot ?? UNKNOWN_REPOSITORY_KEY;
    const now = this.now();
    const lastFired = this.lastFiredByRepository.get(key);

    if (lastFired !== undefined && now - lastFired < this.dedupeWindowMs) {
      return;
    }

    this.lastFiredByRepository.set(key, now);
    this.pushEmitter.fire(event);
  }

  public stop(): void {
    for (const subscription of this.childSubscriptions) {
      subscription.dispose();
    }
    this.childSubscriptions = [];

    for (const child of this.children) {
      child.stop();
    }

    this.lastFiredByRepository.clear();
    this.started = false;
  }

  public dispose(): void {
    this.stop();

    for (const child of this.children) {
      if (isDisposable(child)) {
        child.dispose();
      }
    }

    this.pushEmitter.dispose();
  }
}

function isDisposable(value: unknown): value is vscode.Disposable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as vscode.Disposable).dispose === "function"
  );
}
