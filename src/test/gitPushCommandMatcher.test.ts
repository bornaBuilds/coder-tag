import * as assert from "node:assert";
import { isGitPushCommand } from "../git/gitPushCommandMatcher";

suite("isGitPushCommand", () => {
  const positives = [
    "git push",
    "git push origin main",
    "git -c user.email=x push",
    "git -C /path push",
    "git push -u origin feature",
    "git push --force",
    "git push --force-with-lease origin main",
    "git -c a=b -C /p push origin main",
    "git.exe push",
    "  git   push  ",
    "npm run build && git push",
    "git commit -m wip && git push",
    "/usr/bin/git push",
    "git --no-pager push",
  ];

  const negatives = [
    "git commit",
    "gitpush",
    "git pushfoo",
    "git pushall",
    "echo git push",
    "git status",
    "git pull",
    "git fetch",
    "git",
    "",
    "   ",
    "git -c k=v commit",
    "mygit push",
    "git push --help",
    "git push -h",
  ];

  for (const commandLine of positives) {
    test(`matches ${JSON.stringify(commandLine)}`, () => {
      assert.strictEqual(isGitPushCommand(commandLine), true);
    });
  }

  for (const commandLine of negatives) {
    test(`rejects ${JSON.stringify(commandLine)}`, () => {
      assert.strictEqual(isGitPushCommand(commandLine), false);
    });
  }
});
