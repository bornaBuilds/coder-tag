import {
  ChildProcess,
  SpawnOptions,
  spawn,
} from "node:child_process";
import * as path from "node:path";

/**
 * Small playback contract that keeps the extension independent of a specific
 * audio package.
 */
export interface AudioPlayer {
  play(filePath: string, volume?: number): Promise<void>;
  stop(): void;
}

export type AudioPlaybackErrorCode =
  | "NO_AUDIO_BACKEND"
  | "PLAYBACK_FAILED"
  | "UNSUPPORTED_PLATFORM";

export class AudioPlaybackError extends Error {
  constructor(
    public readonly code: AudioPlaybackErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AudioPlaybackError";
  }
}

export interface PlaybackCommand {
  readonly name: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
}

export type SpawnAudioProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

interface PlaybackSession {
  child?: ChildProcess;
  stopped: boolean;
}

interface CommandFailure {
  readonly commandName: string;
  readonly error: Error;
  readonly missingExecutable: boolean;
  readonly stderr: string;
}

const maxStderrLength = 4_096;

const windowsPlaybackScript = [
  "Add-Type -AssemblyName PresentationCore",
  "$player = New-Object System.Windows.Media.MediaPlayer",
  "$player.Open([Uri]::new($env:CODER_TAG_AUDIO_PATH))",
  "$player.Volume = [double]::Parse($env:CODER_TAG_AUDIO_VOLUME, [System.Globalization.CultureInfo]::InvariantCulture)",
  "$player.Play()",
  "$deadline = (Get-Date).AddSeconds(5)",
  "while (-not $player.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 25 }",
  "if (-not $player.NaturalDuration.HasTimeSpan) { throw 'The audio file did not become ready for playback.' }",
  "$remaining = $player.NaturalDuration.TimeSpan.TotalMilliseconds - $player.Position.TotalMilliseconds",
  "if ($remaining -gt 0) { Start-Sleep -Milliseconds ([Math]::Ceiling($remaining)) }",
  "$player.Close()",
].join("; ");

const defaultSpawnAudioProcess: SpawnAudioProcess = (
  executable,
  args,
  options,
) => spawn(executable, [...args], options);

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

/**
 * Produces commands without invoking a shell, so file paths remain ordinary
 * arguments rather than executable command text.
 */
export function createPlaybackCommands(
  platform: NodeJS.Platform,
  filePath: string,
  volume = 1,
): readonly PlaybackCommand[] {
  const safeVolume = clampVolume(volume);

  switch (platform) {
    case "darwin":
      return [{
        name: "afplay",
        executable: "/usr/bin/afplay",
        args: ["-v", String(safeVolume), filePath],
      }];
    case "win32":
      return [{
        name: "Windows MediaPlayer",
        executable: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          windowsPlaybackScript,
        ],
        environment: {
          CODER_TAG_AUDIO_PATH: filePath,
          CODER_TAG_AUDIO_VOLUME: String(safeVolume),
        },
      }];
    case "linux": {
      const commands: PlaybackCommand[] = [
        {
          name: "ffplay",
          executable: "ffplay",
          args: [
            "-nodisp",
            "-autoexit",
            "-loglevel",
            "error",
            "-volume",
            String(Math.round(safeVolume * 100)),
            filePath,
          ],
        },
        {
          name: "pw-play",
          executable: "pw-play",
          args: [`--volume=${safeVolume}`, filePath],
        },
        {
          name: "paplay",
          executable: "paplay",
          args: [
            `--volume=${Math.round(safeVolume * 65_536)}`,
            filePath,
          ],
        },
      ];

      if (path.extname(filePath).toLowerCase() === ".wav") {
        commands.push({
          name: "aplay",
          executable: "aplay",
          args: ["--quiet", filePath],
        });
      }

      return commands;
    }
    default:
      throw new AudioPlaybackError(
        "UNSUPPORTED_PLATFORM",
        `Audio playback is not supported on ${platform}.`,
      );
  }
}

/**
 * Uses the host operating system's audio tools and owns at most one playback
 * process at a time.
 */
export class PlatformAudioPlayer implements AudioPlayer {
  private activeSession: PlaybackSession | undefined;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnAudioProcess =
      defaultSpawnAudioProcess,
  ) {}

  public async play(filePath: string, volume = 1): Promise<void> {
    this.stop();

    const commands = createPlaybackCommands(
      this.platform,
      filePath,
      volume,
    );
    const session: PlaybackSession = { stopped: false };
    const failures: CommandFailure[] = [];
    this.activeSession = session;

    try {
      for (const command of commands) {
        if (session.stopped) {
          return;
        }

        try {
          await this.runCommand(command, session);
          return;
        } catch (error) {
          if (session.stopped) {
            return;
          }

          failures.push(this.toCommandFailure(command, error));
        }
      }

      throw this.createPlaybackError(failures);
    } finally {
      if (this.activeSession === session) {
        this.activeSession = undefined;
      }
    }
  }

  public stop(): void {
    const session = this.activeSession;

    if (!session) {
      return;
    }

    session.stopped = true;
    session.child?.kill();
    this.activeSession = undefined;
  }

  private async runCommand(
    command: PlaybackCommand,
    session: PlaybackSession,
  ): Promise<void> {
    let child: ChildProcess;

    try {
      child = this.spawnProcess(
        command.executable,
        command.args,
        {
          env: command.environment
            ? { ...process.env, ...command.environment }
            : process.env,
          shell: false,
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
    } catch (error) {
      throw this.asError(error);
    }

    session.child = child;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let stderr = "";

      const settle = (action: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;

        if (session.child === child) {
          session.child = undefined;
        }

        action();
      };

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string | Buffer) => {
        if (stderr.length < maxStderrLength) {
          stderr = (stderr + chunk.toString()).slice(0, maxStderrLength);
        }
      });
      child.once("error", (error) => {
        settle(() => {
          if (session.stopped) {
            resolve();
            return;
          }

          reject(this.attachCommandDetails(error, command.name, stderr));
        });
      });
      child.once("close", (code, signal) => {
        settle(() => {
          if (session.stopped) {
            resolve();
            return;
          }

          if (code === 0) {
            resolve();
            return;
          }

          const outcome = signal
            ? `signal ${signal}`
            : `exit code ${String(code)}`;
          reject(
            this.attachCommandDetails(
              new Error(`${command.name} ended with ${outcome}.`),
              command.name,
              stderr,
            ),
          );
        });
      });
    });
  }

  private attachCommandDetails(
    error: Error,
    commandName: string,
    stderr: string,
  ): Error {
    return Object.assign(error, {
      audioCommandName: commandName,
      audioCommandStderr: stderr,
    });
  }

  private toCommandFailure(
    command: PlaybackCommand,
    error: unknown,
  ): CommandFailure {
    const safeError = this.asError(error);
    const errorWithDetails = safeError as Error & {
      audioCommandStderr?: unknown;
      code?: unknown;
    };

    return {
      commandName: command.name,
      error: safeError,
      missingExecutable: errorWithDetails.code === "ENOENT",
      stderr:
        typeof errorWithDetails.audioCommandStderr === "string"
          ? errorWithDetails.audioCommandStderr
          : "",
    };
  }

  private createPlaybackError(
    failures: readonly CommandFailure[],
  ): AudioPlaybackError {
    const attemptedPlayers = failures
      .map((failure) => failure.commandName)
      .join(", ");
    const allExecutablesMissing =
      failures.length > 0 &&
      failures.every((failure) => failure.missingExecutable);
    const diagnostics = failures.map((failure) => ({
      player: failure.commandName,
      error: failure.error,
      stderr: failure.stderr,
    }));

    if (this.platform === "linux" && allExecutablesMissing) {
      return new AudioPlaybackError(
        "NO_AUDIO_BACKEND",
        "No supported Linux audio player was found. Install ffmpeg, PipeWire, PulseAudio utilities, or ALSA utilities.",
        { cause: diagnostics },
      );
    }

    return new AudioPlaybackError(
      "PLAYBACK_FAILED",
      attemptedPlayers
        ? `Audio playback failed with: ${attemptedPlayers}.`
        : "Audio playback failed.",
      { cause: diagnostics },
    );
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
