import * as vscode from "vscode";
import { PlatformAudioPlayer } from "./audio/audioPlayer";
import { AudioManager } from "./audio/audioManager";
import { CommandManager } from "./commands/commands";
import { CompositePushDetector } from "./git/compositePushDetector";
import { GitManager } from "./git/gitManager";
import { GitOperationPushDetector } from "./git/gitOperationPushDetector";
import { GitPublishPushDetector } from "./git/pushDetector";
import { PushHandler } from "./git/pushHandler";
import { TerminalPushDetector } from "./git/terminalPushDetector";
import { SettingsManager } from "./settings/settings";
import { SoundLibraryManager } from "./sounds/soundLibraryManager";
import { StatusBarManager } from "./ui/statusBar";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const settings = new SettingsManager();
  const soundLibrary = new SoundLibraryManager(
    context.extensionUri,
    context.globalStorageUri,
    context.globalState,
    settings,
  );
  const libraryInitialization = await soundLibrary.initialize();
  const audioPlayer = new PlatformAudioPlayer();
  const audioManager = new AudioManager(
    audioPlayer,
    settings,
    soundLibrary,
  );
  const gitManager = new GitManager();
  const pushDetector = new CompositePushDetector([
    new GitPublishPushDetector(gitManager),
    new GitOperationPushDetector(gitManager, {
      includeSync: () => settings.syncCountsAsPush(),
    }),
    new TerminalPushDetector(gitManager),
  ]);
  const pushHandler = new PushHandler(audioManager);
  const commandManager = new CommandManager(
    audioManager,
    soundLibrary,
    settings,
    pushHandler,
  );
  const statusBar = new StatusBarManager(settings, soundLibrary);

  commandManager.register();

  if (
    libraryInitialization.removedUserSounds > 0 ||
    libraryInitialization.missingBuiltInSounds.length > 0
  ) {
    const issues: string[] = [];

    if (libraryInitialization.removedUserSounds > 0) {
      issues.push(
        `${libraryInitialization.removedUserSounds} unavailable custom producer tag(s) were removed`,
      );
    }

    if (libraryInitialization.missingBuiltInSounds.length > 0) {
      issues.push(
        `${libraryInitialization.missingBuiltInSounds.length} bundled producer tag(s) are missing; reinstall Coder Tag`,
      );
    }

    void vscode.window
      .showWarningMessage(`Coder Tag: ${issues.join(". ")}.`, "Add Sound")
      .then(async (selection) => {
        if (selection === "Add Sound") {
          await vscode.commands.executeCommand("coderTag.addSound");
        }
      });
  }

  const pushSubscription = pushDetector.onDidPush((event) => {
    void pushHandler.handlePush(event).catch((error: unknown) => {
      console.error("Coder Tag: failed to handle a push event.", error);
    });
  });

  context.subscriptions.push(
    settings,
    soundLibrary,
    pushDetector,
    pushSubscription,
    commandManager,
    statusBar,
    new vscode.Disposable(() => audioManager.stop()),
  );

  await pushDetector.start();
  console.log("Coder Tag extension activated.");
}

export function deactivate() {}
