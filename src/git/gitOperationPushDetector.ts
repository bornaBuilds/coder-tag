import * as vscode from "vscode";
import { InternalRepository } from "./gitApi";
import { GitManager } from "./gitManager";
import { PushDetector, PushEvent } from "./pushDetector";

/**
 * Git operation kinds that always play a push tag. Isolated as a set so the
 * roadmap (pull/merge/fetch tags) only needs to extend this list. The Source
 * Control Sync button reports the `Sync` kind (a pull followed by a push) and is
 * handled separately, gated behind the `includeSync` option.
 */
const PUSH_OPERATION_KINDS = new Set<string>(["Push"]);

const SYNC_OPERATION_KIND = "Sync";

export interface GitOperationPushDetectorOptions {
  /**
   * When this returns true, a successful `Sync` operation (the Source Control
   * Sync button / auto-sync, which pulls then pushes) also plays the tag.
   */
  readonly includeSync?: () => boolean;
}

/**
 * Detects pushes performed through VS Code's Source Control UI (the push /
 * push to… commands and "Git: Push"). The public Git API exposes no push
 * result, so this taps the git extension's internal per-repository
 * `onDidRunOperation` event — the same signal VS Code uses for its own
 * "Successfully pushed" notification.
 *
 * The internal model is accessed defensively: if its shape ever changes, this
 * detector degrades to a no-op while the terminal and publish detectors keep
 * working.
 */
export class GitOperationPushDetector
  implements PushDetector, vscode.Disposable
{
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private readonly repositorySubscriptions = new Map<
    InternalRepository,
    vscode.Disposable
  >();
  private modelSubscriptions: vscode.Disposable[] = [];
  private started = false;

  constructor(
    private readonly gitManager: GitManager,
    private readonly options?: GitOperationPushDetectorOptions,
  ) {}

  public readonly onDidPush = this.pushEmitter.event;

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    await this.gitManager.initialize();
    const model = this.gitManager.getModel();

    if (!model) {
      console.warn(
        "Coder Tag: the Git model is unavailable; Source Control push detection is disabled.",
      );
      return;
    }

    for (const repository of model.repositories) {
      this.attach(repository);
    }

    this.modelSubscriptions.push(
      model.onDidOpenRepository((repository) => this.attach(repository)),
      model.onDidCloseRepository((repository) => this.detach(repository)),
    );
  }

  private attach(entry: InternalRepository): void {
    if (this.repositorySubscriptions.has(entry)) {
      return;
    }

    // The model may hand back a wrapper (e.g. Cursor's fork) whose base
    // repository — the object carrying onDidRunOperation — is on `.repository`.
    const base = this.resolveBaseRepository(entry);
    const onDidRunOperation = base?.onDidRunOperation;

    if (!base || typeof onDidRunOperation !== "function") {
      console.warn(
        "Coder Tag: a repository did not expose onDidRunOperation; Source Control push detection is unavailable for it.",
      );
      return;
    }

    try {
      const subscription = onDidRunOperation((result) => {
        if (result?.error) {
          return;
        }

        const kind = result?.operation?.kind;
        if (!kind || !this.shouldPlayForKind(kind)) {
          return;
        }

        this.pushEmitter.fire({
          source: "git-operation",
          timestamp: Date.now(),
          repositoryRoot: base.root,
          repositoryRootIsExact: base.root !== undefined,
          branch: base.HEAD?.name,
        });
      });

      this.repositorySubscriptions.set(entry, subscription);
      console.log(
        `Coder Tag: watching Git operations for ${base.root ?? "a repository"}.`,
      );
    } catch (error) {
      console.error(
        "Coder Tag: failed to observe Git operations for a repository.",
        error,
      );
    }
  }

  /**
   * Resolves the object that actually carries `onDidRunOperation`: the entry
   * itself when it is a base repository, or its nested `.repository` when the
   * model returns a wrapper.
   */
  private resolveBaseRepository(
    entry: InternalRepository | undefined,
  ): InternalRepository | undefined {
    if (!entry) {
      return undefined;
    }

    if (typeof entry.onDidRunOperation === "function") {
      return entry;
    }

    const inner = entry.repository;
    if (inner && typeof inner.onDidRunOperation === "function") {
      return inner;
    }

    return undefined;
  }

  private shouldPlayForKind(kind: string): boolean {
    if (PUSH_OPERATION_KINDS.has(kind)) {
      return true;
    }

    return kind === SYNC_OPERATION_KIND && this.options?.includeSync?.() === true;
  }

  private detach(repository: InternalRepository): void {
    const subscription = this.repositorySubscriptions.get(repository);
    subscription?.dispose();
    this.repositorySubscriptions.delete(repository);
  }

  public stop(): void {
    for (const subscription of this.repositorySubscriptions.values()) {
      subscription.dispose();
    }
    this.repositorySubscriptions.clear();

    for (const subscription of this.modelSubscriptions) {
      subscription.dispose();
    }
    this.modelSubscriptions = [];
    this.started = false;
  }

  public dispose(): void {
    this.stop();
    this.pushEmitter.dispose();
  }
}
