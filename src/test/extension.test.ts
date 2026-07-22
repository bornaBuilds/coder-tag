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
      "coderTag.setVolume",
      "coderTag.openSettings",
      "coderTag.testPush",
      "coderTag.showMenu",
    ];

    for (const command of expectedCommands) {
      assert.ok(commands.includes(command), `${command} was not registered`);
    }

    const bundledSounds = [
      "demo-tag-1.wav",
      "demo-tag-2.wav",
      "demo-tag-3.wav",
      "chat-gpt-made-it.mp3",
      "metro-boomin-once-more.mp3",
      "if-young-metro-dont-trust-you.mp3",
      "coby-jesil-ti.mp3",
    ];

    for (const fileName of bundledSounds) {
      const soundUri = vscode.Uri.joinPath(
        extension.extensionUri,
        "media",
        fileName,
      );
      const stat = await vscode.workspace.fs.stat(soundUri);
      assert.ok(stat.size > 44, `${soundUri.fsPath} is not a valid audio asset`);
    }
  });
});
