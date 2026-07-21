import sound from "sound-play";

/**
 * Small playback contract that keeps the extension independent of a specific
 * audio package.
 */
export interface AudioPlayer {
  play(filePath: string, volume?: number): Promise<void>;
  stop(): void;
}

export class SoundPlayAudioPlayer implements AudioPlayer {
  public async play(filePath: string, volume?: number): Promise<void> {
    await sound.play(filePath, volume);
  }

  public stop(): void {
    // sound-play does not expose a reliable cross-platform stop operation.
  }
}
