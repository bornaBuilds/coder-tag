import * as vscode from "vscode";
import { GitAPI, GitExtension } from "./gitApi";

/**
 * Loads the public API exported by VS Code's built-in Git extension.
 *
 * Git support is optional: callers receive undefined when Git is disabled or
 * unavailable, allowing the rest of Coder Tag to keep working.
 */
export class GitManager {
  private gitAPI: GitAPI | undefined;

  public async initialize(): Promise<GitAPI | undefined> {
    if (this.gitAPI) {
      return this.gitAPI;
    }

    const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");

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
}
