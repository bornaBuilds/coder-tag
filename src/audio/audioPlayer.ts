import sound from "sound-play";

export interface AudioPlayer {
  play(filePath: string): Promise<void>;
  stop(): void;
}

export class SoundPlayAudioPlayer implements AudioPlayer {
  public async play(filePath: string): Promise<void> {
    try {
      await sound.play(filePath);
    } catch (error) {
      console.error("Error playing audio:", error);
    }
  }

  public stop(): void {
    // sound-play does not currently
    // expose a simple cross-platform
    // stop method.
    //
    // We can improve this later.
  }
}
