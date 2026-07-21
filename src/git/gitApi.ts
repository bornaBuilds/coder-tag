import * as vscode from "vscode";

/**
 * Minimal typings for the public API exported by VS Code's built-in Git
 * extension. Keeping this surface small makes it harder to accidentally rely
 * on internal methods that may not exist at runtime.
 */
export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
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
