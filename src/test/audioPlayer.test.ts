import * as assert from "node:assert";
import { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  AudioPlaybackError,
  PlatformAudioPlayer,
  SpawnAudioProcess,
  createPlaybackCommands,
} from "../audio/audioPlayer";

class FakeChildProcess extends EventEmitter {
  public readonly stderr = new PassThrough();
  public killCount = 0;

  public kill(): boolean {
    this.killCount += 1;
    queueMicrotask(() => this.emit("close", null, "SIGTERM"));
    return true;
  }

  public asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

function emitSuccess(child: FakeChildProcess): void {
  queueMicrotask(() => child.emit("close", 0, null));
}

function emitFailure(child: FakeChildProcess, code = 1): void {
  queueMicrotask(() => child.emit("close", code, null));
}

function emitMissingExecutable(child: FakeChildProcess): void {
  const error = Object.assign(new Error("Executable not found"), {
    code: "ENOENT",
  });
  queueMicrotask(() => child.emit("error", error));
}

suite("PlatformAudioPlayer", () => {
  test("builds safe platform commands and maps volume", () => {
    const hostilePath = "/tmp/my tag'; Write-Error 'oops.wav";
    const macCommands = createPlaybackCommands(
      "darwin",
      hostilePath,
      0.25,
    );
    assert.deepStrictEqual(macCommands[0]?.args, [
      "-v",
      "0.25",
      hostilePath,
    ]);

    const windowsCommands = createPlaybackCommands(
      "win32",
      hostilePath,
      0.25,
    );
    assert.strictEqual(windowsCommands[0]?.executable, "powershell.exe");
    assert.strictEqual(
      windowsCommands[0]?.environment?.CODER_TAG_AUDIO_PATH,
      hostilePath,
    );
    assert.strictEqual(
      windowsCommands[0]?.args.some((argument) =>
        argument.includes(hostilePath)),
      false,
    );

    const linuxCommands = createPlaybackCommands(
      "linux",
      "/tmp/tag.wav",
      0.25,
    );
    assert.deepStrictEqual(
      linuxCommands.map((command) => command.name),
      ["ffplay", "pw-play", "paplay", "aplay"],
    );
    assert.ok(linuxCommands[0]?.args.includes("25"));
    assert.ok(linuxCommands[1]?.args.includes("--volume=0.25"));
    assert.ok(linuxCommands[2]?.args.includes("--volume=16384"));

    const mp3Commands = createPlaybackCommands(
      "linux",
      "/tmp/tag.mp3",
      2,
    );
    assert.deepStrictEqual(
      mp3Commands.map((command) => command.name),
      ["ffplay", "pw-play", "paplay"],
    );
    assert.ok(mp3Commands[0]?.args.includes("100"));
  });

  test("falls back when a Linux player is missing or fails", async () => {
    const attemptedExecutables: string[] = [];
    const spawnProcess: SpawnAudioProcess = (
      executable: string,
      _args: readonly string[],
      _options: SpawnOptions,
    ) => {
      attemptedExecutables.push(executable);
      const child = new FakeChildProcess();

      if (executable === "ffplay") {
        emitMissingExecutable(child);
      } else if (executable === "pw-play") {
        child.stderr.end("Unsupported format");
        emitFailure(child);
      } else {
        emitSuccess(child);
      }

      return child.asChildProcess();
    };
    const player = new PlatformAudioPlayer("linux", spawnProcess);

    await player.play("/tmp/tag.mp3", 0.5);

    assert.deepStrictEqual(attemptedExecutables, [
      "ffplay",
      "pw-play",
      "paplay",
    ]);
  });

  test("reports when Linux has no playback backend", async () => {
    let spawnCount = 0;
    const spawnProcess: SpawnAudioProcess = () => {
      spawnCount += 1;
      const child = new FakeChildProcess();
      emitMissingExecutable(child);
      return child.asChildProcess();
    };
    const player = new PlatformAudioPlayer("linux", spawnProcess);

    await assert.rejects(
      player.play("/tmp/tag.mp3"),
      (error: unknown) =>
        error instanceof AudioPlaybackError &&
        error.code === "NO_AUDIO_BACKEND",
    );
    assert.strictEqual(spawnCount, 3);
  });

  test("stops active playback before starting another tag", async () => {
    const children: FakeChildProcess[] = [];
    const spawnProcess: SpawnAudioProcess = () => {
      const child = new FakeChildProcess();
      children.push(child);

      if (children.length === 2) {
        emitSuccess(child);
      }

      return child.asChildProcess();
    };
    const player = new PlatformAudioPlayer("darwin", spawnProcess);
    const firstPlayback = player.play("/tmp/first.wav");
    await new Promise<void>((resolve) => setImmediate(resolve));

    const secondPlayback = player.play("/tmp/second.wav");
    await Promise.all([firstPlayback, secondPlayback]);

    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0]?.killCount, 1);
    assert.strictEqual(children[1]?.killCount, 0);
  });

  test("stop terminates owned playback and resolves cleanly", async () => {
    const child = new FakeChildProcess();
    const spawnProcess: SpawnAudioProcess = () => child.asChildProcess();
    const player = new PlatformAudioPlayer("darwin", spawnProcess);
    const playback = player.play("/tmp/tag.wav");
    await new Promise<void>((resolve) => setImmediate(resolve));

    player.stop();
    await playback;

    assert.strictEqual(child.killCount, 1);
  });

  test("rejects unsupported host platforms before spawning", async () => {
    let spawned = false;
    const spawnProcess: SpawnAudioProcess = () => {
      spawned = true;
      return new FakeChildProcess().asChildProcess();
    };
    const player = new PlatformAudioPlayer("freebsd", spawnProcess);

    await assert.rejects(
      player.play("/tmp/tag.wav"),
      (error: unknown) =>
        error instanceof AudioPlaybackError &&
        error.code === "UNSUPPORTED_PLATFORM",
    );
    assert.strictEqual(spawned, false);
  });
});
