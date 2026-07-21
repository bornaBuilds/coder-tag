import * as vscode from "vscode";

export interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  repositories: Repository[];

  onDidOpenRepository(
    listener: (repository: Repository) => void,
  ): vscode.Disposable;
}

export interface Repository {
  rootUri: vscode.Uri;

  onDidRunOperation(
    listener: (event: GitOperationEvent) => void,
  ): vscode.Disposable;
}

export interface GitOperationEvent {
  operation: string;
}

export class GitManager {
  private gitAPI: GitAPI | undefined;

  public async initialize(): Promise<void> {
    const gitExtension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");

    if (!gitExtension) {
      console.warn("Git extension not found");
      return;
    }

    const git = gitExtension.exports;

    if (!git) {
      return;
    }

    this.gitAPI = git.getAPI(1);

    for (const repository of this.gitAPI.repositories) {
      this.subscribeToRepository(repository);
    }

    this.gitAPI.onDidOpenRepository((repository) => {
      this.subscribeToRepository(repository);
    });
  }

  private subscribeToRepository(repository: Repository): void {
    repository.onDidRunOperation((event) => {
      console.log(`Git operation: ${event.operation}`);
    });
  }
}
