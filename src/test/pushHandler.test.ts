import * as assert from "node:assert";
import { PushAudioManager, PushHandler } from "../git/pushHandler";

suite("PushHandler", () => {
  test("routes an event to the audio manager once", async () => {
    let playCount = 0;
    const audioManager: PushAudioManager = {
      async playSelectedTag(): Promise<void> {
        playCount += 1;
      },
    };
    const handler = new PushHandler(audioManager);

    await handler.handlePush({
      source: "manual",
      timestamp: Date.now(),
    });

    assert.strictEqual(playCount, 1);
  });
});
