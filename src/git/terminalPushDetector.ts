import * as vscode from "vscode";
import { GitManager } from "./gitManager";
import { isGitPushCommand } from "./gitPushCommandMatcher";
import { PushDetector, PushEvent } from "./pushDetector";

/**
 * Detects successful `git push` commands run in VS Code's integrated terminal,
 * using the Terminal Shell Integration API (stable since VS Code 1.93).
 *
 * This requires shell integration to be active for the terminal. When it is
 * not (unsupported shell, integration disabled, or an external terminal),
 * `onDidEndTerminalShellExecution` simply never fires and this detector stays
 * inert without affecting the other detectors.
 */
export class TerminalPushDetector implements PushDetector, vscode.Disposable {
  private readonly pushEmitter = new vscode.EventEmitter<PushEvent>();
  private subscription: vscode.Disposable | undefined;
  private started = false;

  /**
   * @param gitManager optional; used only to normalize a terminal's working
   * directory to its git root so dedupe keys align with the operation detector.
   */
  constructor(private readonly gitManager?: GitManager) {}

  public readonly onDidPush = this.pushEmitter.event;

  public start(): Promise<void> {
    if (this.started) {
      return Promise.resolve();
    }

    this.started = true;
    this.subscription = vscode.window.onDidEndTerminalShellExecution((event) =>
      this.handleExecution(event),
    );

    return Promise.resolve();
  }

  private handleExecution(event: vscode.TerminalShellExecutionEndEvent): void {
    // Only a clean exit is a successful push. An undefined exit code means shell
    // integration could not determine the result, so we stay quiet.
    if (event.exitCode !== 0) {
      return;
    }

    const commandLine = event.execution.commandLine;

    // Low-confidence command lines are read from the terminal buffer rather
    // than reported explicitly by the shell. This is common with customized
    // zsh prompts, so do not reject them outright; the strict command matcher
    // below still requires an actual `git push` invocation.
    if (!isGitPushCommand(commandLine.value)) {
      return;
    }

    this.pushEmitter.fire({
      source: "terminal",
      timestamp: Date.now(),
      repositoryRoot: this.resolveRepositoryRoot(event.execution.cwd),
    });
  }

  private resolveRepositoryRoot(cwd: vscode.Uri | undefined): string | undefined {
    if (!cwd) {
      return undefined;
    }

    const repositoryRoot = this.gitManager?.getModel()?.getRepository(cwd)?.root;
    return repositoryRoot ?? cwd.fsPath;
  }

  public stop(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
    this.started = false;
  }

  public dispose(): void {
    this.stop();
    this.pushEmitter.dispose();
  }
}
