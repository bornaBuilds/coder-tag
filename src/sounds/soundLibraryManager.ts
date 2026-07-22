import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { defaultSoundId, ProducerTag } from "./producerTag";

const userSoundsStorageKey = "coderTag.userSounds";
const supportedExtensions = new Set([".mp3", ".wav"]);

export interface SoundLibrarySettings {
  getSelectedSoundId(): string | undefined;
  setSelectedSoundId(soundId: string | undefined): Promise<void>;
}

export interface SoundLibraryInitializationResult {
  readonly migratedUserSounds: number;
  readonly removedUserSounds: number;
  readonly missingBuiltInSounds: readonly ProducerTag[];
}

/**
 * Owns the catalog of built-in and user-added sounds. User files are copied
 * into extension-managed global storage so they remain available if the
 * original files are moved or deleted.
 */
export class SoundLibraryManager implements vscode.Disposable {
  private readonly builtInSounds: ProducerTag[];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly managedSoundsDirectory: string;
  private readonly unavailableBuiltInSoundIds = new Set<string>();
  private userSounds: ProducerTag[];

  public readonly onDidChange = this.changeEmitter.event;

  constructor(
    extensionUri: vscode.Uri,
    globalStorageUri: vscode.Uri,
    private readonly storage: vscode.Memento,
    private readonly settings: SoundLibrarySettings,
  ) {
    this.managedSoundsDirectory = vscode.Uri.joinPath(
      globalStorageUri,
      "sounds",
    ).fsPath;
    this.builtInSounds = [
      this.createBuiltInSound(
        extensionUri,
        defaultSoundId,
        "Demo Tag 1",
        "demo-tag-1.wav",
      ),
      this.createBuiltInSound(
        extensionUri,
        "builtin-demo-2",
        "Demo Tag 2",
        "demo-tag-2.wav",
      ),
      this.createBuiltInSound(
        extensionUri,
        "builtin-demo-3",
        "Demo Tag 3",
        "demo-tag-3.wav",
      ),
      this.createBuiltInSound(
        extensionUri,
        "builtin-chat-gpt-made-it",
        "Chat GPT made it",
        "chat-gpt-made-it.mp3",
      ),
      this.createBuiltInSound(
        extensionUri,
        "builtin-metro-boomin-once-more",
        "Metro Boomin - Once More",
        "metro-boomin-once-more.mp3",
      ),
      this.createBuiltInSound(
        extensionUri,
        "builtin-if-young-metro-dont-trust-you",
        "If Young Metro, Don't Trust You",
        "if-young-metro-dont-trust-you.mp3",
      ),
      this.createBuiltInSound(
        extensionUri,
        "builtin-coby",
        "Coby Jesil ti",
        "coby-jesil-ti.mp3",
      ),
    ];
    this.userSounds = this.loadUserSounds();
  }

  public async initialize(): Promise<SoundLibraryInitializationResult> {
    await fs.mkdir(this.managedSoundsDirectory, { recursive: true });

    const missingBuiltInSounds: ProducerTag[] = [];
    this.unavailableBuiltInSoundIds.clear();

    for (const sound of this.builtInSounds) {
      if (!(await this.isReadableFile(sound.filePath))) {
        missingBuiltInSounds.push(sound);
        this.unavailableBuiltInSoundIds.add(sound.id);
      }
    }

    const normalizedSounds: ProducerTag[] = [];
    const knownHashes = new Set<string>();
    let migratedUserSounds = 0;
    let removedUserSounds = 0;
    let catalogChanged = false;

    for (const sound of this.userSounds) {
      const extension = path.extname(sound.filePath).toLowerCase();

      if (
        !supportedExtensions.has(extension) ||
        !(await this.isReadableFile(sound.filePath))
      ) {
        removedUserSounds += 1;
        catalogChanged = true;
        continue;
      }

      let managedPath = sound.filePath;

      if (!this.isManagedSoundPath(managedPath)) {
        managedPath = path.join(
          this.managedSoundsDirectory,
          `${sound.id}${extension}`,
        );

        try {
          await fs.copyFile(sound.filePath, managedPath);
          migratedUserSounds += 1;
          catalogChanged = true;
        } catch (error) {
          console.error(
            `Coder Tag: could not migrate "${sound.name}" into managed storage.`,
            error,
          );
          removedUserSounds += 1;
          catalogChanged = true;
          continue;
        }
      }

      let contentHash: string;

      try {
        contentHash = sound.contentHash ?? await this.hashFile(managedPath);
      } catch (error) {
        console.error(
          `Coder Tag: could not validate "${sound.name}".`,
          error,
        );
        if (this.isManagedSoundPath(managedPath)) {
          await fs.rm(managedPath, { force: true }).catch(() => undefined);
        }
        removedUserSounds += 1;
        catalogChanged = true;
        continue;
      }

      if (knownHashes.has(contentHash)) {
        if (this.isManagedSoundPath(managedPath)) {
          await fs.rm(managedPath, { force: true }).catch(() => undefined);
        }
        removedUserSounds += 1;
        catalogChanged = true;
        continue;
      }

      knownHashes.add(contentHash);
      const normalizedSound: ProducerTag = {
        ...sound,
        filePath: path.resolve(managedPath),
        contentHash,
      };
      normalizedSounds.push(normalizedSound);

      if (
        normalizedSound.filePath !== sound.filePath ||
        normalizedSound.contentHash !== sound.contentHash
      ) {
        catalogChanged = true;
      }
    }

    if (catalogChanged) {
      this.userSounds = normalizedSounds;
      await this.persistUserSounds();
    }

    const selectedId = this.settings.getSelectedSoundId();
    const selectedSound = selectedId ? this.findById(selectedId) : undefined;
    let selectionChanged = false;

    if (!selectedSound) {
      const fallback = this.builtInSounds.find(
        (sound) => !this.unavailableBuiltInSoundIds.has(sound.id),
      );
      await this.settings.setSelectedSoundId(fallback?.id);
      selectionChanged = true;
    }

    if (catalogChanged || selectionChanged) {
      this.changeEmitter.fire();
    }

    return {
      migratedUserSounds,
      removedUserSounds,
      missingBuiltInSounds,
    };
  }

  public getBuiltInSounds(): readonly ProducerTag[] {
    return this.builtInSounds.filter(
      (sound) => !this.unavailableBuiltInSoundIds.has(sound.id),
    );
  }

  public getUserSounds(): readonly ProducerTag[] {
    return [...this.userSounds];
  }

  public getAllSounds(): readonly ProducerTag[] {
    return [...this.getBuiltInSounds(), ...this.userSounds];
  }

  public findById(id: string): ProducerTag | undefined {
    return this.getAllSounds().find((sound) => sound.id === id);
  }

  public getSelectedSound(): ProducerTag | undefined {
    const selectedId = this.settings.getSelectedSoundId();
    return selectedId ? this.findById(selectedId) : undefined;
  }

  public async setSelectedSound(id: string): Promise<ProducerTag> {
    const sound = this.findById(id);

    if (!sound) {
      throw new Error("The selected producer tag is not in the sound library.");
    }

    await this.settings.setSelectedSoundId(id);
    this.changeEmitter.fire();
    return sound;
  }

  public async addLocalAudioFile(filePath: string): Promise<ProducerTag> {
    const extension = path.extname(filePath).toLowerCase();

    if (!supportedExtensions.has(extension)) {
      throw new Error("Unsupported audio format. Choose an MP3 or WAV file.");
    }

    let file: Awaited<ReturnType<typeof fs.stat>>;

    try {
      file = await fs.stat(filePath);
    } catch (error) {
      console.error("Coder Tag: could not read the selected audio file.", error);
      throw new Error(
        "The selected audio file could not be found or read.",
      );
    }

    if (!file.isFile()) {
      throw new Error("The selected path is not an audio file.");
    }

    await fs.mkdir(this.managedSoundsDirectory, { recursive: true });
    const contentHash = await this.hashFile(filePath);

    if (
      this.userSounds.some((sound) => sound.contentHash === contentHash)
    ) {
      throw new Error("That producer tag is already in your sound library.");
    }

    const id = `user-${randomUUID()}`;
    const managedPath = path.join(
      this.managedSoundsDirectory,
      `${id}${extension}`,
    );
    const sound: ProducerTag = {
      id,
      name: path.basename(filePath, extension),
      filePath: path.resolve(managedPath),
      source: "user",
      contentHash,
    };

    await fs.copyFile(filePath, managedPath);

    const nextSounds = [...this.userSounds, sound];

    try {
      await this.storage.update(userSoundsStorageKey, nextSounds);
      this.userSounds = nextSounds;
    } catch (error) {
      await fs.rm(managedPath, { force: true }).catch(() => undefined);
      throw error;
    }

    this.changeEmitter.fire();
    return sound;
  }

  public async removeUserSound(id: string): Promise<ProducerTag> {
    const sound = this.userSounds.find((candidate) => candidate.id === id);

    if (!sound) {
      throw new Error("Only user-added producer tags can be removed.");
    }

    const nextSounds = this.userSounds.filter(
      (candidate) => candidate.id !== id,
    );
    await this.storage.update(userSoundsStorageKey, nextSounds);
    this.userSounds = nextSounds;

    if (this.settings.getSelectedSoundId() === id) {
      await this.settings.setSelectedSoundId(defaultSoundId);
    }

    if (this.isManagedSoundPath(sound.filePath)) {
      try {
        await fs.rm(sound.filePath, { force: true });
      } catch (error) {
        console.warn(
          `Coder Tag: could not delete managed file for "${sound.name}".`,
          error,
        );
      }
    }

    this.changeEmitter.fire();
    return sound;
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }

  private createBuiltInSound(
    extensionUri: vscode.Uri,
    id: string,
    name: string,
    fileName: string,
  ): ProducerTag {
    return {
      id,
      name,
      filePath: vscode.Uri.joinPath(extensionUri, "media", fileName).fsPath,
      source: "builtin",
    };
  }

  private loadUserSounds(): ProducerTag[] {
    const storedSounds = this.storage.get<unknown[]>(userSoundsStorageKey, []);
    return storedSounds.filter(
      (value): value is ProducerTag =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as ProducerTag).id === "string" &&
        typeof (value as ProducerTag).name === "string" &&
        typeof (value as ProducerTag).filePath === "string" &&
        (value as ProducerTag).source === "user" &&
        (
          (value as ProducerTag).contentHash === undefined ||
          typeof (value as ProducerTag).contentHash === "string"
        ),
    );
  }

  private async persistUserSounds(): Promise<void> {
    await this.storage.update(userSoundsStorageKey, this.userSounds);
  }

  private async isReadableFile(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private isManagedSoundPath(filePath: string): boolean {
    const relativePath = path.relative(
      this.managedSoundsDirectory,
      path.resolve(filePath),
    );
    return (
      relativePath.length > 0 &&
      !relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath)
    );
  }

  private async hashFile(filePath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);

      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }
}
