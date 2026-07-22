import * as assert from "node:assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AudioPlaybackError,
  AudioPlayer,
} from "../audio/audioPlayer";
import {
  AudioManager,
  getPlaybackErrorMessage,
} from "../audio/audioManager";
import { SettingsManager } from "../settings/settings";
import { ProducerTag } from "../sounds/producerTag";
import { SoundLibraryManager } from "../sounds/soundLibraryManager";

class RecordingAudioPlayer implements AudioPlayer {
  public readonly plays: Array<{
    filePath: string;
    volume: number | undefined;
  }> = [];
  public stopCount = 0;

  public async play(
    filePath: string,
    volume?: number,
  ): Promise<void> {
    this.plays.push({ filePath, volume });
  }

  public stop(): void {
    this.stopCount += 1;
  }
}

function createSettings(
  enabled: boolean,
  volume: number,
): SettingsManager {
  return {
    isEnabled: () => enabled,
    getVolume: () => volume,
  } as unknown as SettingsManager;
}

function createSoundLibrary(
  selectedSound: ProducerTag | undefined,
): SoundLibraryManager {
  return {
    getSelectedSound: () => selectedSound,
  } as unknown as SoundLibraryManager;
}

suite("AudioManager", () => {
  test("plays the selected sound with configured volume when enabled", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "coder-tag-audio-manager-"),
    );
    const filePath = path.join(tempDirectory, "selected.wav");
    await fs.writeFile(filePath, Buffer.from("RIFF-test-WAVE"));
    const sound: ProducerTag = {
      id: "selected",
      name: "Selected",
      filePath,
      source: "user",
    };
    const player = new RecordingAudioPlayer();
    const manager = new AudioManager(
      player,
      createSettings(true, 0.4),
      createSoundLibrary(sound),
    );

    try {
      await manager.playSelectedTag();
      assert.deepStrictEqual(player.plays, [
        { filePath, volume: 0.4 },
      ]);
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });

  test("skips push playback when disabled but still allows preview", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "coder-tag-audio-preview-"),
    );
    const filePath = path.join(tempDirectory, "preview.mp3");
    await fs.writeFile(filePath, Buffer.from("test"));
    const sound: ProducerTag = {
      id: "preview",
      name: "Preview",
      filePath,
      source: "user",
    };
    const player = new RecordingAudioPlayer();
    const manager = new AudioManager(
      player,
      createSettings(false, 0.75),
      createSoundLibrary(sound),
    );

    try {
      await manager.playSelectedTag();
      assert.strictEqual(player.plays.length, 0);

      await manager.preview(sound);
      assert.deepStrictEqual(player.plays, [
        { filePath, volume: 0.75 },
      ]);
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });

  test("does not invoke the player for unsupported or missing files", async () => {
    const player = new RecordingAudioPlayer();
    const manager = new AudioManager(
      player,
      createSettings(true, 1),
      createSoundLibrary(undefined),
    );

    await manager.preview({
      id: "unsupported",
      name: "Unsupported",
      filePath: path.join(os.tmpdir(), "tag.ogg"),
      source: "user",
    });
    await manager.preview({
      id: "missing",
      name: "Missing",
      filePath: path.join(
        os.tmpdir(),
        `missing-${Date.now()}.wav`,
      ),
      source: "user",
    });

    assert.strictEqual(player.plays.length, 0);
  });

  test("maps filesystem and backend errors to useful messages", () => {
    const missingFileError = Object.assign(new Error("missing"), {
      code: "ENOENT",
    });
    assert.strictEqual(
      getPlaybackErrorMessage(missingFileError),
      "The selected audio file could not be found.",
    );

    const noBackendError = new AudioPlaybackError(
      "NO_AUDIO_BACKEND",
      "Install a supported audio player.",
    );
    assert.strictEqual(
      getPlaybackErrorMessage(noBackendError),
      "Install a supported audio player.",
    );

    assert.strictEqual(
      getPlaybackErrorMessage(new Error("decoder failed")),
      "The selected audio file could not be played.",
    );
  });

  test("delegates stop to the audio player", () => {
    const player = new RecordingAudioPlayer();
    const manager = new AudioManager(
      player,
      createSettings(true, 1),
      createSoundLibrary(undefined),
    );

    manager.stop();

    assert.strictEqual(player.stopCount, 1);
  });
});
