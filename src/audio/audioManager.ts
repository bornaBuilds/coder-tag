import * as vscode from "vscode";
import { AudioPlayer } from "./audioPlayer";
import { SettingsManager } from "../settings/settings";

export class AudioManager {
  constructor(
    private readonly player: AudioPlayer,
    private readonly settings: SettingsManager,
  ) {}

  public async playSelectedTag(): Promise<void> {
    const enabled = this.settings.isEnabled();

    if (!enabled) {
      return;
    }

    const filePath = this.settings.getSelectedSound();

    if (!filePath) {
      vscode.window.showWarningMessage(
        "No Coder Tag selected. Please configure in the extension settings.",
      );
      return;
    }

    await this.player.play(filePath);
  }
}
