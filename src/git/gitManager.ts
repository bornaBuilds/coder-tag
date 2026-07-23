import * as vscode from "vscode";
import { GitAPI, GitExtension, GitModelInternal } from "./gitApi";

/**
 * Loads the API exported by VS Code's built-in Git extension and centralizes
 * every reach into that extension (public API and, defensively, its internal
 * model).
 *
 * Git support is optional: callers receive undefined when Git is disabled or
 * unavailable, allowing the rest of Coder Tag to keep working.
 */
export class GitManager {
  private gitAPI: GitAPI | undefined;
  private gitExtensionExports: GitExtension | undefined;
  private initialization: Promise<GitAPI | undefined> | undefined;

  public async initialize(): Promise<GitAPI | undefined> {
    if (this.gitAPI) {
      return this.gitAPI;
    }

    // Several detectors call initialize() concurrently at startup; share a
    // single activation instead of triggering the Git extension twice.
    if (!this.initialization) {
      this.initialization = this.doInitialize();
    }

    try {
      return await this.initialization;
    } finally {
      this.initialization = undefined;
    }
  }

  private async doInitialize(): Promise<GitAPI | undefined> {
    const gitExtension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");

    if (!gitExtension) {
      console.warn("Coder Tag: the built-in Git extension is unavailable.");
      return undefined;
    }

    try {
      const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();

      if (!git?.enabled) {
        console.warn("Coder Tag: the built-in Git extension is disabled.");
        return undefined;
      }

      this.gitExtensionExports = git;
      this.gitAPI = git.getAPI(1);
      return this.gitAPI;
    } catch (error) {
      console.error("Coder Tag: failed to initialize Git integration.", error);
      return undefined;
    }
  }

  public getAPI(): GitAPI | undefined {
    return this.gitAPI;
  }

  /**
   * Normalizes a path reported by terminal or Trace2 integration to the root
   * shape used by Git operation events, including Cursor's repository wrapper.
   */
  public resolveRepositoryRoot(uri: vscode.Uri): string {
    return this.findRepositoryRoot(uri) ?? uri.fsPath;
  }

  public findRepositoryRoot(uri: vscode.Uri): string | undefined {
    const entry = this.getModel()?.getRepository(uri);
    return entry?.root ?? entry?.repository?.root;
  }

  /**
   * Returns the git extension's internal model when it exposes the shape we
   * rely on, otherwise undefined. This is an unsupported API surface, so the
   * result is validated before use and callers must degrade gracefully.
   */
  public getModel(): GitModelInternal | undefined {
    const model = this.gitExtensionExports?.model;

    if (
      !model ||
      !Array.isArray(model.repositories) ||
      typeof model.onDidOpenRepository !== "function" ||
      typeof model.onDidCloseRepository !== "function"
    ) {
      return undefined;
    }

    return model;
  }
}
