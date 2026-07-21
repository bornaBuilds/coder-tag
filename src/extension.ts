import * as vscode from "vscode";

import { SoundPlayAudioPlayer } from "./audio/audioPlayer";

import { AudioManager } from "./audio/audioManager";

import { SettingsManager } from "./settings/settings";

import { GitManager } from "./git/gitManager";

export async function activate(context: vscode.ExtensionContext) {
  const settings = new SettingsManager();

  const audioPlayer = new SoundPlayAudioPlayer();

  const audioManager = new AudioManager(audioPlayer, settings);

  const gitManager = new GitManager();

  await gitManager.initialize();

  console.log("Coder Tag extension activated");
}

export function deactivate() {}
