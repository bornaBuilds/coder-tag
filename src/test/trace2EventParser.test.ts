import * as assert from "node:assert";
import {
  Trace2EventParser,
  Trace2PushCompletion,
} from "../git/trace2EventParser";

function event(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`;
}

suite("Trace2EventParser", () => {
  test("emits a successful push with its repository root", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("stream", event({
      event: "start",
      sid: "push-1",
      argv: ["git", "push", "origin", "main"],
    }));
    parser.acceptChunk("stream", event({
      event: "def_repo",
      sid: "push-1",
      worktree: "/repo",
    }));
    parser.acceptChunk("stream", event({
      event: "exit",
      sid: "push-1",
      code: 0,
    }));

    assert.deepStrictEqual(completions, [{
      sid: "push-1",
      repositoryRoot: "/repo",
    }]);
  });

  test("ignores failed pushes and non-push commands", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("failed", event({
      event: "start",
      sid: "failed",
      argv: ["git", "push"],
    }));
    parser.acceptChunk("failed", event({
      event: "exit",
      sid: "failed",
      code: 1,
    }));
    parser.acceptChunk("status", event({
      event: "start",
      sid: "status",
      argv: ["git", "status"],
    }));
    parser.acceptChunk("status", event({
      event: "exit",
      sid: "status",
      code: 0,
    }));

    assert.deepStrictEqual(completions, []);
  });

  test("handles fragmented and batched JSON lines", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });
    const start = event({
      event: "start",
      sid: "fragmented",
      argv: ["git", "-c", "push.default=current", "push"],
    });
    const exit = event({
      event: "exit",
      sid: "fragmented",
      code: 0,
    });

    parser.acceptChunk("stream", start.slice(0, 12));
    parser.acceptChunk("stream", start.slice(12) + exit);

    assert.strictEqual(completions.length, 1);
    assert.strictEqual(completions[0].sid, "fragmented");
  });

  test("preserves multibyte repository paths split across chunks", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });
    const records = Buffer.from(
      event({
        event: "start",
        sid: "unicode",
        argv: ["git", "push"],
      }) +
      event({
        event: "def_repo",
        sid: "unicode",
        worktree: "/répo",
      }) +
      event({
        event: "exit",
        sid: "unicode",
        code: 0,
      }),
    );
    const multibyteStart = records.indexOf(Buffer.from("é"));

    parser.acceptChunk("stream", records.subarray(0, multibyteStart + 1));
    parser.acceptChunk("stream", records.subarray(multibyteStart + 1));

    assert.strictEqual(completions[0].repositoryRoot, "/répo");
  });

  test("tracks concurrent and nested session IDs exactly", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("parent", event({
      event: "start",
      sid: "parent",
      argv: ["git", "push"],
    }));
    parser.acceptChunk("other", event({
      event: "start",
      sid: "other",
      argv: ["/usr/bin/git", "-C", "/repo", "push"],
    }));
    parser.acceptChunk("child", event({
      event: "exit",
      sid: "parent/child",
      code: 0,
    }));
    parser.acceptChunk("other", event({
      event: "exit",
      sid: "other",
      code: 0,
    }));
    parser.acceptChunk("parent", event({
      event: "exit",
      sid: "parent",
      code: 0,
    }));

    assert.deepStrictEqual(
      completions.map((completion) => completion.sid),
      ["other", "parent"],
    );
  });

  test("recovers after malformed and oversized records", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      maxLineLength: 200,
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("stream", "{not json}\n");
    parser.acceptChunk("stream", "x".repeat(201));
    parser.acceptChunk("stream", `still oversized\n${event({
      event: "start",
      sid: "valid",
      argv: ["git", "push"],
    })}${event({
      event: "exit",
      sid: "valid",
      code: 0,
    })}`);

    assert.strictEqual(completions.length, 1);
    assert.strictEqual(completions[0].sid, "valid");
  });

  test("discards incomplete sessions when their stream closes", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("stream", event({
      event: "start",
      sid: "closed",
      argv: ["git", "push"],
    }));
    parser.endStream("stream");
    parser.acceptChunk("new-stream", event({
      event: "exit",
      sid: "closed",
      code: 0,
    }));

    assert.deepStrictEqual(completions, []);
  });

  test("keeps a push pending until its stream reports completion", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("stream", event({
      event: "start",
      sid: "long-running",
      argv: ["git", "push"],
    }));
    for (let index = 0; index < 100; index += 1) {
      parser.acceptChunk("stream", event({
        event: "data",
        sid: "long-running/child",
        category: "progress",
      }));
    }
    parser.acceptChunk("stream", event({
      event: "exit",
      sid: "long-running",
      code: 0,
    }));

    assert.strictEqual(completions[0].sid, "long-running");
  });

  test("replaces an abandoned candidate on the same stream", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("stream", event({
      event: "start",
      sid: "abandoned",
      argv: ["git", "push"],
    }));
    parser.acceptChunk("stream", event({
      event: "start",
      sid: "replacement",
      argv: ["git", "push"],
    }));
    parser.acceptChunk("stream", event({
      event: "exit",
      sid: "abandoned",
      code: 0,
    }));
    parser.acceptChunk("stream", event({
      event: "exit",
      sid: "replacement",
      code: 0,
    }));

    assert.deepStrictEqual(
      completions.map((completion) => completion.sid),
      ["replacement"],
    );
  });

  test("clears a pending push after a signal event", () => {
    const completions: Trace2PushCompletion[] = [];
    const parser = new Trace2EventParser({
      onSuccessfulPush: (completion) => completions.push(completion),
    });

    parser.acceptChunk("stream", event({
      event: "start",
      sid: "signalled",
      argv: ["git", "push"],
    }));
    parser.acceptChunk("stream", event({
      event: "signal",
      sid: "signalled",
    }));
    parser.acceptChunk("stream", event({
      event: "exit",
      sid: "signalled",
      code: 0,
    }));

    assert.deepStrictEqual(completions, []);
  });
});
