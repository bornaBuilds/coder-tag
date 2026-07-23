import { StringDecoder } from "node:string_decoder";
import { isGitPushArgv } from "./gitPushCommandMatcher";

const DEFAULT_MAX_LINE_LENGTH = 256 * 1024;

export interface Trace2PushCompletion {
  readonly sid: string;
  readonly repositoryRoot?: string;
}

export interface Trace2EventParserOptions {
  readonly onSuccessfulPush: (completion: Trace2PushCompletion) => void;
  readonly maxLineLength?: number;
}

interface StreamState {
  buffer: string;
  discardingOversizedLine: boolean;
  readonly decoder: StringDecoder;
  readonly pendingSids: Set<string>;
}

interface PendingPush {
  readonly streamId: string;
  repositoryRoot?: string;
}

/**
 * Parses Git Trace2 EVENT records without retaining or logging raw command
 * data. Each socket connection has independent line framing because Git opens
 * one stream per process and chunks can split a JSON record at any byte.
 */
export class Trace2EventParser {
  private readonly streams = new Map<string, StreamState>();
  private readonly pendingPushes = new Map<string, PendingPush>();
  private readonly maxLineLength: number;

  constructor(private readonly options: Trace2EventParserOptions) {
    this.maxLineLength =
      options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  }

  public acceptChunk(streamId: string, chunk: string | Buffer): void {
    const state = this.getOrCreateStream(streamId);
    let text =
      typeof chunk === "string" ? chunk : state.decoder.write(chunk);

    if (state.discardingOversizedLine) {
      const newlineIndex = text.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      state.discardingOversizedLine = false;
      text = text.slice(newlineIndex + 1);
    }

    const input = state.buffer + text;
    state.buffer = "";

    let lineStart = 0;
    let newlineIndex = input.indexOf("\n", lineStart);

    while (newlineIndex !== -1) {
      const line = input
        .slice(lineStart, newlineIndex)
        .replace(/\r$/, "");

      if (line.length <= this.maxLineLength) {
        this.processLine(streamId, state, line);
      }

      lineStart = newlineIndex + 1;
      newlineIndex = input.indexOf("\n", lineStart);
    }

    const remainder = input.slice(lineStart);
    if (remainder.length > this.maxLineLength) {
      state.discardingOversizedLine = true;
      return;
    }

    state.buffer = remainder;
  }

  public endStream(streamId: string): void {
    const state = this.streams.get(streamId);
    if (!state) {
      return;
    }

    for (const sid of state.pendingSids) {
      this.pendingPushes.delete(sid);
    }

    state.decoder.end();
    this.streams.delete(streamId);
  }

  public reset(): void {
    this.streams.clear();
    this.pendingPushes.clear();
  }

  private processLine(
    streamId: string,
    state: StreamState,
    line: string,
  ): void {
    if (!line) {
      return;
    }

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }

    if (!isRecord(record)) {
      return;
    }

    const event = record.event;
    const sid = record.sid;
    if (typeof event !== "string" || typeof sid !== "string") {
      return;
    }

    if (event === "start") {
      if (!isStringArray(record.argv) || !isGitPushArgv(record.argv)) {
        return;
      }

      // A Trace2 connection belongs to one Git process. Replacing any
      // abandoned candidate on that stream bounds untrusted in-memory state
      // without expiring valid long-running pushes.
      for (const pendingSid of state.pendingSids) {
        this.pendingPushes.delete(pendingSid);
      }
      state.pendingSids.clear();
      this.removePending(sid);
      this.pendingPushes.set(sid, {
        streamId,
      });
      state.pendingSids.add(sid);
      return;
    }

    const pending = this.pendingPushes.get(sid);
    if (!pending) {
      return;
    }

    if (event === "def_repo") {
      if (typeof record.worktree === "string" && record.worktree.length > 0) {
        pending.repositoryRoot = record.worktree;
      }
      return;
    }

    if (event === "exit") {
      const completion = this.removePending(sid);
      if (completion && record.code === 0) {
        this.options.onSuccessfulPush({
          sid,
          repositoryRoot: completion.repositoryRoot,
        });
      }
      return;
    }

    if (event === "signal") {
      this.removePending(sid);
    }
  }

  private getOrCreateStream(streamId: string): StreamState {
    let state = this.streams.get(streamId);
    if (!state) {
      state = {
        buffer: "",
        discardingOversizedLine: false,
        decoder: new StringDecoder("utf8"),
        pendingSids: new Set<string>(),
      };
      this.streams.set(streamId, state);
    }

    return state;
  }

  private removePending(sid: string): PendingPush | undefined {
    const pending = this.pendingPushes.get(sid);
    if (!pending) {
      return undefined;
    }

    this.pendingPushes.delete(sid);
    this.streams.get(pending.streamId)?.pendingSids.delete(sid);
    return pending;
  }

}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  );
}
