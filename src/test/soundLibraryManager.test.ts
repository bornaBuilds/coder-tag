import * as assert from "node:assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  SoundLibraryManager,
  SoundLibrarySettings,
} from "../sounds/soundLibraryManager";

suite("SoundLibraryManager", () => {
  test("adds, selects, and removes only metadata for a user sound", async () => {
    const values = new Map<string, unknown>();
    const storage = {
      get<T>(key: string, defaultValue?: T): T | undefined {
        return (values.has(key) ? values.get(key) : defaultValue) as
          | T
          | undefined;
      },
      async update(key: string, value: unknown): Promise<void> {
        values.set(key, value);
      },
      keys(): readonly string[] {
        return [...values.keys()];
      },
    } as unknown as vscode.Memento;
    let selectedId: string | undefined;
    const settings: SoundLibrarySettings = {
      getSelectedSoundId: () => selectedId,
      async setSelectedSoundId(id: string | undefined): Promise<void> {
        selectedId = id;
      },
    };
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "coder-tag-test-"),
    );
    const audioPath = path.join(tempDirectory, "my-tag.wav");
    await fs.writeFile(audioPath, Buffer.from("RIFF-test-WAVE"));

    const library = new SoundLibraryManager(
      vscode.Uri.file(tempDirectory),
      storage,
      settings,
    );

    try {
      assert.strictEqual(library.getBuiltInSounds().length, 3);

      const added = await library.addLocalAudioFile(audioPath);
      assert.strictEqual(added.source, "user");
      assert.strictEqual(library.getUserSounds().length, 1);

      await library.setSelectedSound(added.id);
      assert.strictEqual(library.getSelectedSound()?.id, added.id);

      await library.removeUserSound(added.id);
      assert.strictEqual(library.getSelectedSound(), undefined);
      assert.strictEqual(library.getUserSounds().length, 0);
      await fs.access(audioPath);
    } finally {
      library.dispose();
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });

  test("rejects unsupported file extensions", async () => {
    const storage = {
      get<T>(_key: string, defaultValue?: T): T | undefined {
        return defaultValue;
      },
      async update(): Promise<void> {},
      keys(): readonly string[] {
        return [];
      },
    } as unknown as vscode.Memento;
    const settings: SoundLibrarySettings = {
      getSelectedSoundId: () => undefined,
      async setSelectedSoundId(): Promise<void> {},
    };
    const library = new SoundLibraryManager(
      vscode.Uri.file(os.tmpdir()),
      storage,
      settings,
    );

    try {
      await assert.rejects(
        library.addLocalAudioFile(path.join(os.tmpdir(), "tag.ogg")),
        /Unsupported audio format/,
      );
    } finally {
      library.dispose();
    }
  });
});
