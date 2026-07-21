import * as vscode from "vscode";
import { SoundPlayAudioPlayer } from "./audio/audioPlayer";
import { AudioManager } from "./audio/audioManager";
import { CommandManager } from "./commands/commands";
import { GitManager } from "./git/gitManager";
import { GitPublishPushDetector } from "./git/pushDetector";
import { PushHandler } from "./git/pushHandler";
import { SettingsManager } from "./settings/settings";
import { SoundLibraryManager } from "./sounds/soundLibraryManager";
import { StatusBarManager } from "./ui/statusBar";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const settings = new SettingsManager();
  const soundLibrary = new SoundLibraryManager(
    context.extensionUri,
    context.globalState,
    settings,
  );
  const audioPlayer = new SoundPlayAudioPlayer();
  const audioManager = new AudioManager(
    audioPlayer,
    settings,
    soundLibrary,
  );
  const gitManager = new GitManager();
  const pushDetector = new GitPublishPushDetector(gitManager);
  const pushHandler = new PushHandler(audioManager);
  const commandManager = new CommandManager(
    audioManager,
    soundLibrary,
    settings,
    pushHandler,
  );
  const statusBar = new StatusBarManager(settings, soundLibrary);

  commandManager.register();

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
