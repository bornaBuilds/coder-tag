import { PushEvent } from "./pushDetector";

export interface PushAudioManager {
  playSelectedTag(): Promise<void>;
}

/**
 * Centralizes what happens after every push event. Real detections and the
 * Test Push command must both call this class.
 */
export class PushHandler {
  constructor(private readonly audioManager: PushAudioManager) {}

  public async handlePush(event: PushEvent): Promise<void> {
    console.log(`Coder Tag: handling ${event.source} push event.`);
    await this.audioManager.playSelectedTag();
  }
}
