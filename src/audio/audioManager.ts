import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AudioPlayer } from "./audioPlayer";
import { SettingsManager } from "../settings/settings";
import { ProducerTag } from "../sounds/producerTag";
import { SoundLibraryManager } from "../sounds/soundLibraryManager";

const supportedExtensions = new Set([".mp3", ".wav"]);

/**
 * Coordinates sound selection, settings, validation, and the AudioPlayer.
 */
export class AudioManager {
  constructor(
    private readonly player: AudioPlayer,
    private readonly settings: SettingsManager,
    private readonly soundLibrary: SoundLibraryManager,
  ) {}

  public async playSelectedTag(): Promise<void> {
    if (!this.settings.isEnabled()) {
      return;
    }

    const sound = this.soundLibrary.getSelectedSound();

    if (!sound) {
      void vscode.window.showWarningMessage("No producer tag selected.");
      return;
    }

    await this.playSound(sound);
  }

  /**
   * Plays a library sound without changing the current selection or enabled
   * state.
   */
  public async preview(sound: ProducerTag): Promise<void> {
    await this.playSound(sound);
  }

  public stop(): void {
    this.player.stop();
  }

  private async playSound(sound: ProducerTag): Promise<void> {
    const extension = path.extname(sound.filePath).toLowerCase();

    if (!supportedExtensions.has(extension)) {
      void vscode.window.showErrorMessage(
        "This producer tag uses an unsupported audio format.",
      );
      return;
    }

    try {
      await fs.access(sound.filePath);
      await this.player.play(sound.filePath, this.settings.getVolume());
    } catch (error) {
      console.error(`Coder Tag: could not play "${sound.name}".`, error);

      const message =
        this.getErrorCode(error) === "ENOENT"
          ? "The selected audio file could not be found."
          : "The selected audio file could not be played.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private getErrorCode(error: unknown): string | undefined {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      return error.code;
    }

    return undefined;
  }
}
