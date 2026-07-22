import * as vscode from "vscode";

/**
 * Minimal typings for the public API exported by VS Code's built-in Git
 * extension. Keeping this surface small makes it harder to accidentally rely
 * on internal methods that may not exist at runtime.
 */
export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
  /**
   * The git extension's internal model. Not part of the public git.d.ts, so it
   * is optional and must be feature-detected. It is the only reachable path to
   * the per-repository `onDidRunOperation` event (see GitManager.getModel).
   */
  readonly model?: GitModelInternal;
}

export interface GitAPI {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
  readonly onDidCloseRepository: vscode.Event<Repository>;
  readonly onDidPublish: vscode.Event<PublishEvent>;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
}

export interface PublishEvent {
  readonly repository: Repository;
  readonly branch?: string;
}

/**
 * Minimal typings for the git extension's INTERNAL model, reached via
 * `gitExtension.exports.model`. These members are preserved un-minified by the
 * extension's bundler, but they are not part of the supported public API, so
 * every field a detector relies on is feature-detected at runtime.
 */
export interface GitModelInternal {
  readonly repositories: readonly InternalRepository[];
  readonly onDidOpenRepository: vscode.Event<InternalRepository>;
  readonly onDidCloseRepository: vscode.Event<InternalRepository>;
  getRepository(uri: vscode.Uri): InternalRepository | undefined | null;
}

export interface InternalRepository {
  readonly root?: string;
  readonly HEAD?: Branch;
  /** Optional so callers must feature-detect before subscribing. */
  readonly onDidRunOperation?: vscode.Event<OperationResult>;
  /**
   * Some model shapes (notably Cursor's fork) return a wrapper whose base
   * repository — the object that actually carries `onDidRunOperation`, `root`,
   * and `HEAD` — is nested here rather than on the entry itself.
   */
  readonly repository?: InternalRepository;
}

export interface OperationResult {
  readonly operation: { readonly kind: string };
  readonly error?: unknown;
}

export interface Branch {
  readonly name?: string;
}
