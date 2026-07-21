import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitHookManager } from "../git/gitHookManager";
import { GitManager } from "../git/gitManager";
import { pushEventFileExtension } from "../git/pushDetector";

function runGit(
  arguments_: readonly string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...arguments_],
      { cwd, encoding: "utf8", windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

function shellPath(filePath: string): string {
  return `'${filePath.replaceAll("\\", "/").replaceAll("'", `'\"'\"'`)}'`;
}

suite("GitHookManager", () => {
  test("chains an existing hook and restores its exact contents", async function () {
    this.timeout(30_000);
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "coder-tag-hook-"),
    );
    const repositoryRoot = path.join(directory, "repository");
    const remoteRoot = path.join(directory, "remote.git");
    const eventDirectory = path.join(directory, "events");
    const originalMarker = path.join(directory, "original-ran.txt");
    const originalInput = path.join(directory, "original-input.txt");
    const hookManager = new GitHookManager(
      new GitManager(),
      eventDirectory,
    );

    try {
      await fs.mkdir(repositoryRoot);
      await runGit(["init"], repositoryRoot);
      await runGit(["config", "user.name", "Coder Tag Test"], repositoryRoot);
      await runGit(
        ["config", "user.email", "coder-tag@example.invalid"],
        repositoryRoot,
      );
      await fs.writeFile(
        path.join(repositoryRoot, "README.md"),
        "hook test\n",
        "utf8",
      );
      await runGit(["add", "README.md"], repositoryRoot);
      await runGit(["commit", "-m", "hook test"], repositoryRoot);
      await runGit(["init", "--bare", remoteRoot], directory);
      await runGit(["remote", "add", "origin", remoteRoot], repositoryRoot);

      const hooksOutput = await runGit(
        ["rev-parse", "--git-path", "hooks"],
        repositoryRoot,
      );
      const hooksDirectory = path.isAbsolute(hooksOutput)
        ? hooksOutput
        : path.resolve(repositoryRoot, hooksOutput);
      const hookPath = path.join(hooksDirectory, "pre-push");
      const backupPath = path.join(
        hooksDirectory,
        "pre-push.coder-tag-backup",
      );
      const originalHook = [
        "#!/bin/sh",
        `printf 'ran\\n' > ${shellPath(originalMarker)}`,
        `cat > ${shellPath(originalInput)}`,
        "exit 7",
        "",
      ].join("\n");
      await fs.writeFile(hookPath, originalHook, {
        encoding: "utf8",
        mode: 0o755,
      });
      await fs.chmod(hookPath, 0o755);

      assert.strictEqual(
        await hookManager.getStatus(repositoryRoot),
        "existing-hook",
      );
      await hookManager.install(repositoryRoot);
      assert.strictEqual(
        await hookManager.getStatus(repositoryRoot),
        "installed",
      );
      assert.strictEqual(await fs.readFile(backupPath, "utf8"), originalHook);

      await assert.rejects(
        runGit(["push", "-u", "origin", "HEAD"], repositoryRoot),
      );
      assert.strictEqual(
        await fs.readFile(originalMarker, "utf8"),
        "ran\n",
      );
      assert.ok((await fs.readFile(originalInput, "utf8")).length > 0);

      const eventFiles = (await fs.readdir(eventDirectory)).filter(
        (fileName) => fileName.endsWith(pushEventFileExtension),
      );
      assert.strictEqual(eventFiles.length, 1);
      const eventRepository = (
        await fs.readFile(
          path.join(eventDirectory, eventFiles[0]),
          "utf8",
        )
      ).trim();
      assert.strictEqual(
        path.resolve(eventRepository),
        path.resolve(repositoryRoot),
      );

      await hookManager.uninstall(repositoryRoot);
      assert.strictEqual(await fs.readFile(hookPath, "utf8"), originalHook);
      await assert.rejects(fs.access(backupPath));
    } finally {
      hookManager.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
