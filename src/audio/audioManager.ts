import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AudioPlaybackError, AudioPlayer } from "./audioPlayer";
import { SettingsManager } from "../settings/settings";
import { ProducerTag } from "../sounds/producerTag";
import { SoundLibraryManager } from "../sounds/soundLibraryManager";

const supportedExtensions = new Set([".mp3", ".wav"]);

export function getPlaybackErrorMessage(error: unknown): string {
  if (getErrorCode(error) === "ENOENT") {
    return "The selected audio file could not be found.";
  }

  if (
    error instanceof AudioPlaybackError &&
    (error.code === "NO_AUDIO_BACKEND" ||
      error.code === "UNSUPPORTED_PLATFORM")
  ) {
    return error.message;
  }

  return "The selected audio file could not be played.";
}

function getErrorCode(error: unknown): string | undefined {
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
      void vscode.window.showErrorMessage(getPlaybackErrorMessage(error));
    }
  }
}
