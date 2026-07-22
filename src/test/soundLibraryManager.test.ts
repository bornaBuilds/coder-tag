import * as assert from "node:assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  SoundLibraryManager,
  SoundLibrarySettings,
} from "../sounds/soundLibraryManager";
import {
  defaultSoundId,
  ProducerTag,
} from "../sounds/producerTag";

const builtInFileNames = [
  "demo-tag-1.wav",
  "demo-tag-2.wav",
  "demo-tag-3.wav",
  "chat-gpt-made-it.mp3",
  "metro-boomin-once-more.mp3",
  "if-young-metro-dont-trust-you.mp3",
  "coby-jesil-ti.mp3",
];

interface TestContext {
  readonly root: string;
  readonly extensionUri: vscode.Uri;
  readonly globalStorageUri: vscode.Uri;
}

async function createTestContext(): Promise<TestContext> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "coder-tag-library-"),
  );
  const extensionRoot = path.join(root, "extension");
  const mediaDirectory = path.join(extensionRoot, "media");
  const globalStorageRoot = path.join(root, "global-storage");
  await fs.mkdir(mediaDirectory, { recursive: true });

  for (const fileName of builtInFileNames) {
    await fs.writeFile(
      path.join(mediaDirectory, fileName),
      Buffer.from(`audio-${fileName}`),
    );
  }

  return {
    root,
    extensionUri: vscode.Uri.file(extensionRoot),
    globalStorageUri: vscode.Uri.file(globalStorageRoot),
  };
}

function createStorage(
  initialSounds: readonly ProducerTag[] = [],
): {
  readonly storage: vscode.Memento;
  readonly values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();

  if (initialSounds.length > 0) {
    values.set("coderTag.userSounds", [...initialSounds]);
  }

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

  return { storage, values };
}

function createSettings(initialId?: string): {
  readonly settings: SoundLibrarySettings;
  readonly getSelectedId: () => string | undefined;
} {
  let selectedId = initialId;
  const settings: SoundLibrarySettings = {
    getSelectedSoundId: () => selectedId,
    async setSelectedSoundId(id: string | undefined): Promise<void> {
      selectedId = id;
    },
  };
  return {
    settings,
    getSelectedId: () => selectedId,
  };
}

suite("SoundLibraryManager", () => {
  test("copies, persists, selects, and removes a custom sound", async () => {
    const context = await createTestContext();
    const { storage } = createStorage();
    const { settings, getSelectedId } = createSettings();
    const sourcePath = path.join(context.root, "my-tag.wav");
    await fs.writeFile(sourcePath, Buffer.from("RIFF-custom-WAVE"));
    const library = new SoundLibraryManager(
      context.extensionUri,
      context.globalStorageUri,
      storage,
      settings,
    );

    try {
      const initialization = await library.initialize();
      assert.strictEqual(initialization.removedUserSounds, 0);
      assert.strictEqual(library.getBuiltInSounds().length, 7);
      assert.strictEqual(getSelectedId(), defaultSoundId);

      const added = await library.addLocalAudioFile(sourcePath);
      assert.strictEqual(added.source, "user");
      assert.ok(added.contentHash);
      assert.ok(
        added.filePath.startsWith(
          path.join(context.globalStorageUri.fsPath, "sounds"),
        ),
      );
      await fs.rm(sourcePath);
      await fs.access(added.filePath);

      await library.setSelectedSound(added.id);
      assert.strictEqual(getSelectedId(), added.id);

      const reloadedLibrary = new SoundLibraryManager(
        context.extensionUri,
        context.globalStorageUri,
        storage,
        settings,
      );

      try {
        await reloadedLibrary.initialize();
        assert.strictEqual(reloadedLibrary.getUserSounds().length, 1);
        assert.strictEqual(
          reloadedLibrary.getSelectedSound()?.id,
          added.id,
        );

        await reloadedLibrary.removeUserSound(added.id);
        assert.strictEqual(reloadedLibrary.getUserSounds().length, 0);
        assert.strictEqual(getSelectedId(), defaultSoundId);
        await assert.rejects(fs.access(added.filePath));
      } finally {
        reloadedLibrary.dispose();
      }
    } finally {
      library.dispose();
      await fs.rm(context.root, { recursive: true, force: true });
    }
  });

  test("migrates legacy external paths into managed storage", async () => {
    const context = await createTestContext();
    const legacyPath = path.join(context.root, "legacy.mp3");
    await fs.writeFile(legacyPath, Buffer.from("legacy-audio"));
    const legacySound: ProducerTag = {
      id: "user-legacy",
      name: "Legacy",
      filePath: legacyPath,
      source: "user",
    };
    const { storage } = createStorage([legacySound]);
    const { settings } = createSettings(legacySound.id);
    const library = new SoundLibraryManager(
      context.extensionUri,
      context.globalStorageUri,
      storage,
      settings,
    );

    try {
      const result = await library.initialize();
      const migrated = library.getUserSounds()[0];
      assert.strictEqual(result.migratedUserSounds, 1);
      assert.notStrictEqual(migrated.filePath, legacyPath);
      assert.ok(migrated.contentHash);
      await fs.access(migrated.filePath);
      await fs.access(legacyPath);
    } finally {
      library.dispose();
      await fs.rm(context.root, { recursive: true, force: true });
    }
  });

  test("prunes missing custom sounds and repairs selection", async () => {
    const context = await createTestContext();
    const missingSound: ProducerTag = {
      id: "user-missing",
      name: "Missing",
      filePath: path.join(context.root, "missing.wav"),
      source: "user",
    };
    const { storage } = createStorage([missingSound]);
    const { settings, getSelectedId } = createSettings(missingSound.id);
    const library = new SoundLibraryManager(
      context.extensionUri,
      context.globalStorageUri,
      storage,
      settings,
    );

    try {
      const result = await library.initialize();
      assert.strictEqual(result.removedUserSounds, 1);
      assert.strictEqual(library.getUserSounds().length, 0);
      assert.strictEqual(getSelectedId(), defaultSoundId);
    } finally {
      library.dispose();
      await fs.rm(context.root, { recursive: true, force: true });
    }
  });

  test("filters missing built-ins and selects an available fallback", async () => {
    const context = await createTestContext();
    await fs.rm(
      path.join(context.extensionUri.fsPath, "media", "demo-tag-1.wav"),
    );
    const { storage } = createStorage();
    const { settings, getSelectedId } = createSettings(defaultSoundId);
    const library = new SoundLibraryManager(
      context.extensionUri,
      context.globalStorageUri,
      storage,
      settings,
    );

    try {
      const result = await library.initialize();
      assert.strictEqual(result.missingBuiltInSounds.length, 1);
      assert.strictEqual(library.getBuiltInSounds().length, 6);
      assert.strictEqual(getSelectedId(), "builtin-demo-2");
    } finally {
      library.dispose();
      await fs.rm(context.root, { recursive: true, force: true });
    }
  });

  test("rejects duplicate and unsupported imports", async () => {
    const context = await createTestContext();
    const sourcePath = path.join(context.root, "tag.wav");
    await fs.writeFile(sourcePath, Buffer.from("duplicate-audio"));
    const { storage } = createStorage();
    const { settings } = createSettings();
    const library = new SoundLibraryManager(
      context.extensionUri,
      context.globalStorageUri,
      storage,
      settings,
    );

    try {
      await library.initialize();
      await library.addLocalAudioFile(sourcePath);
      await assert.rejects(
        library.addLocalAudioFile(sourcePath),
        /already in your sound library/,
      );
      await assert.rejects(
        library.addLocalAudioFile(path.join(context.root, "tag.ogg")),
        /Unsupported audio format/,
      );
    } finally {
      library.dispose();
      await fs.rm(context.root, { recursive: true, force: true });
    }
  });
});
