import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Coder Tag extension", () => {
  test("activates, registers commands, and includes demo sounds", async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === "coder-tag",
    );

    assert.ok(extension, "Coder Tag extension was not found");
    await extension.activate();
    assert.strictEqual(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    const expectedCommands = [
      "coderTag.preview",
      "coderTag.selectSound",
      "coderTag.addSound",
      "coderTag.removeSound",
      "coderTag.toggleEnabled",
      "coderTag.testPush",
      "coderTag.installPushHook",
      "coderTag.uninstallPushHook",
      "coderTag.showMenu",
    ];

    for (const command of expectedCommands) {
      assert.ok(commands.includes(command), `${command} was not registered`);
    }

    for (let index = 1; index <= 3; index += 1) {
      const soundUri = vscode.Uri.joinPath(
        extension.extensionUri,
        "media",
        `demo-tag-${index}.wav`,
      );
      const stat = await vscode.workspace.fs.stat(soundUri);
      assert.ok(stat.size > 44, `${soundUri.fsPath} is not a valid WAV asset`);
    }
  });
});
