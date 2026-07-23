import * as vscode from "vscode";
import * as path from "node:path";
import { PushDetector, PushEvent } from "./pushDetector";

export interface CompositePushDetectorOptions {
  readonly dedupeWindowMs?: number;
  readonly now?: () => number;
}

const DEFAULT_DEDUPE_WINDOW_MS = 1500;

interface RecentPush {
  readonly repositoryRoot: string;
  readonly repositoryRootIsExact: boolean;
  readonly source: PushEvent["source"];
  readonly timestamp: number;
}

/**
 * Fans several push detectors into a single stream and suppresses duplicate
 * events for the same repository within a short window.
 *
 * Known overlaps are paired one-to-one: first-time publish can surface as both
 * git-operation and git-publish, while a terminal push can surface through
 * both shell integration and the macOS Trace2 fallback. Repeated events from
 * one source remain distinct.
 */
export class CompositePushDetector implements PushDetector, vscode.Disposable {
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private recentPushes: RecentPush[] = [];
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
    const now = this.now();
    const repositoryRoot = normalizeRepositoryKey(event.repositoryRoot);
    this.recentPushes = this.recentPushes.filter((entry) =>
      now - entry.timestamp < this.dedupeWindowMs
    );

    if (repositoryRoot) {
      const counterpartIndex = this.recentPushes.findIndex((entry) =>
        sourcesOverlap(entry.source, event.source) &&
        repositoriesOverlap(
          entry.repositoryRoot,
          repositoryRoot,
          entry.repositoryRootIsExact,
          event.repositoryRootIsExact === true,
          entry.source,
          event.source,
        )
      );

      if (counterpartIndex !== -1) {
        this.recentPushes.splice(counterpartIndex, 1);
        return;
      }

      this.recentPushes.push({
        repositoryRoot,
        repositoryRootIsExact: event.repositoryRootIsExact === true,
        source: event.source,
        timestamp: now,
      });
    }

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

    this.recentPushes = [];
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

function normalizeRepositoryKey(
  repositoryRoot: string | undefined,
): string | undefined {
  return repositoryRoot ? path.resolve(repositoryRoot) : undefined;
}

function sourcesOverlap(
  first: PushEvent["source"],
  second: PushEvent["source"],
): boolean {
  return (
    (first === "terminal" && second === "terminal-trace2") ||
    (first === "terminal-trace2" && second === "terminal") ||
    (first === "git-operation" && second === "git-publish") ||
    (first === "git-publish" && second === "git-operation")
  );
}

function repositoriesOverlap(
  firstRoot: string,
  secondRoot: string,
  firstRootIsExact: boolean,
  secondRootIsExact: boolean,
  firstSource: PushEvent["source"],
  secondSource: PushEvent["source"],
): boolean {
  if (firstRoot === secondRoot) {
    return true;
  }

  if (
    (firstSource === "terminal" && secondSource === "terminal-trace2") ||
    (firstSource === "terminal-trace2" && secondSource === "terminal")
  ) {
    const terminalRoot =
      firstSource === "terminal" ? firstRoot : secondRoot;
    const terminalRootIsExact =
      firstSource === "terminal" ? firstRootIsExact : secondRootIsExact;
    const traceRoot =
      firstSource === "terminal-trace2" ? firstRoot : secondRoot;

    return (
      !terminalRootIsExact &&
      isSameOrDescendant(terminalRoot, traceRoot)
    );
  }

  return false;
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

function isDisposable(value: unknown): value is vscode.Disposable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as vscode.Disposable).dispose === "function"
  );
}
