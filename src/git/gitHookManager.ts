import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { GitManager } from "./gitManager";
import { pushEventFileExtension } from "./pushDetector";

export const coderTagHookMarker = "# Coder Tag pre-push hook v1";
const backupFileName = "pre-push.coder-tag-backup";

export type HookStatus =
  | "installed"
  | "not-installed"
  | "existing-hook"
  | "conflict";

/**
 * Installs and safely removes Coder Tag's pre-push dispatcher. Existing hooks
 * are moved byte-for-byte to a backup and invoked by the dispatcher.
 */
export class GitHookManager implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private initialized = false;

  public readonly onDidChangeRepositories = this.changeEmitter.event;

  constructor(
    private readonly gitManager: GitManager,
    private readonly eventDirectory: string,
  ) {}

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    const gitAPI = await this.gitManager.initialize();

    if (!gitAPI) {
      return;
    }

    this.subscriptions.push(
      gitAPI.onDidOpenRepository(() => this.changeEmitter.fire()),
      gitAPI.onDidCloseRepository(() => this.changeEmitter.fire()),
    );
  }

  public async getOpenRepositoryRoots(): Promise<readonly string[]> {
    const gitAPI = await this.gitManager.initialize();
    return gitAPI?.repositories.map(
      (repository) => repository.rootUri.fsPath,
    ) ?? [];
  }

  public async getStatus(repositoryRoot: string): Promise<HookStatus> {
    const hookPaths = await this.getHookPaths(repositoryRoot);
    const expectedHook = this.createHookScript(hookPaths.backupPath);
    const hookExists = await this.fileExists(hookPaths.hookPath);
    const backupExists = await this.fileExists(hookPaths.backupPath);

    if (!hookExists) {
      return backupExists ? "conflict" : "not-installed";
    }

    const hookContents = await fs.readFile(hookPaths.hookPath, "utf8");

    if (hookContents === expectedHook) {
      return "installed";
    }

    if (
      hookContents.includes(coderTagHookMarker) ||
      backupExists
    ) {
      return "conflict";
    }

    return "existing-hook";
  }

  public async install(repositoryRoot: string): Promise<void> {
    const hookPaths = await this.getHookPaths(repositoryRoot);
    await fs.mkdir(hookPaths.hooksDirectory, { recursive: true });

    const expectedHook = this.createHookScript(hookPaths.backupPath);
    const hookExists = await this.fileExists(hookPaths.hookPath);
    const backupExists = await this.fileExists(hookPaths.backupPath);

    if (hookExists) {
      const hookContents = await fs.readFile(hookPaths.hookPath, "utf8");

      if (hookContents === expectedHook) {
        return;
      }

      if (hookContents.includes(coderTagHookMarker) || backupExists) {
        throw new Error(
          "The existing Coder Tag hook was modified. Resolve the hook files manually before reinstalling.",
        );
      }

      await fs.rename(hookPaths.hookPath, hookPaths.backupPath);
    } else if (backupExists) {
      throw new Error(
        "A Coder Tag hook backup exists without its dispatcher. Resolve the hook files manually before installing.",
      );
    }

    const temporaryPath = `${hookPaths.hookPath}.${randomUUID()}.tmp`;

    try {
      await fs.writeFile(temporaryPath, expectedHook, {
        encoding: "utf8",
        mode: 0o755,
      });
      await fs.chmod(temporaryPath, 0o755);
      await fs.rename(temporaryPath, hookPaths.hookPath);
    } catch (error) {
      await this.removeIfPresent(temporaryPath);

      if (
        hookExists &&
        (await this.fileExists(hookPaths.backupPath)) &&
        !(await this.fileExists(hookPaths.hookPath))
      ) {
        await fs.rename(hookPaths.backupPath, hookPaths.hookPath);
      }

      throw error;
    }

    this.changeEmitter.fire();
  }

  public async uninstall(repositoryRoot: string): Promise<void> {
    const hookPaths = await this.getHookPaths(repositoryRoot);
    const expectedHook = this.createHookScript(hookPaths.backupPath);

    if (!(await this.fileExists(hookPaths.hookPath))) {
      if (await this.fileExists(hookPaths.backupPath)) {
        throw new Error(
          "The Coder Tag dispatcher is missing but its backup remains. Restore it manually to avoid overwriting external changes.",
        );
      }

      return;
    }

    const hookContents = await fs.readFile(hookPaths.hookPath, "utf8");

    if (hookContents !== expectedHook) {
      throw new Error(
        "The pre-push hook changed after Coder Tag installed it. It was not removed.",
      );
    }

    const removingPath = `${hookPaths.hookPath}.${randomUUID()}.removing`;
    await fs.rename(hookPaths.hookPath, removingPath);

    try {
      if (await this.fileExists(hookPaths.backupPath)) {
        await fs.rename(hookPaths.backupPath, hookPaths.hookPath);
      }

      await fs.unlink(removingPath);
    } catch (error) {
      if (
        !(await this.fileExists(hookPaths.hookPath)) &&
        (await this.fileExists(removingPath))
      ) {
        await fs.rename(removingPath, hookPaths.hookPath);
      }

      throw error;
    }

    this.changeEmitter.fire();
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.changeEmitter.dispose();
  }

  private async getHookPaths(repositoryRoot: string): Promise<{
    hooksDirectory: string;
    hookPath: string;
    backupPath: string;
  }> {
    const hooksOutput = await this.runGit(repositoryRoot, [
      "rev-parse",
      "--git-path",
      "hooks",
    ]);
    const hooksDirectory = path.isAbsolute(hooksOutput)
      ? path.normalize(hooksOutput)
      : path.resolve(repositoryRoot, hooksOutput);

    return {
      hooksDirectory,
      hookPath: path.join(hooksDirectory, "pre-push"),
      backupPath: path.join(hooksDirectory, backupFileName),
    };
  }

  private createHookScript(backupPath: string): string {
    const eventDirectory = this.quoteForShell(
      this.toHookPath(this.eventDirectory),
    );
    const backup = this.quoteForShell(this.toHookPath(backupPath));

    return [
      "#!/bin/sh",
      coderTagHookMarker,
      `coder_tag_event_dir=${eventDirectory}`,
      `coder_tag_backup=${backup}`,
      "",
      'coder_tag_repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"',
      'coder_tag_temp=\"$coder_tag_event_dir/push-$(date +%s)-$$.tmp\"',
      `coder_tag_event="\${coder_tag_temp%.tmp}${pushEventFileExtension}"`,
      "",
      'mkdir -p "$coder_tag_event_dir"',
      "if printf '%s\\n' \"$coder_tag_repo_root\" > \"$coder_tag_temp\"; then",
      '  mv "$coder_tag_temp" "$coder_tag_event"',
      "fi",
      "",
      'if [ -x "$coder_tag_backup" ]; then',
      '  "$coder_tag_backup" "$@"',
      "  exit $?",
      "fi",
      "",
      "exit 0",
      "",
    ].join("\n");
  }

  private async runGit(
    repositoryRoot: string,
    arguments_: readonly string[],
  ): Promise<string> {
    const gitAPI = await this.gitManager.initialize();
    const gitExecutable = gitAPI?.git.path ?? "git";

    return new Promise<string>((resolve, reject) => {
      execFile(
        gitExecutable,
        ["-C", repositoryRoot, ...arguments_],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) {
            reject(
              new Error(
                `Git could not locate the hooks directory for ${repositoryRoot}.`,
                { cause: error },
              ),
            );
            return;
          }

          resolve(stdout.trim());
        },
      );
    });
  }

  private toHookPath(filePath: string): string {
    return filePath.replaceAll("\\", "/");
  }

  private quoteForShell(value: string): string {
    return `'${value.replaceAll("'", `'\"'\"'`)}'`;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async removeIfPresent(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // Best-effort cleanup after a failed installation.
    }
  }
}
