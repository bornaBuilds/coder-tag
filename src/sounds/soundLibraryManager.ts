import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { ProducerTag } from "./producerTag";

const userSoundsStorageKey = "coderTag.userSounds";
const supportedExtensions = new Set([".mp3", ".wav"]);

export interface SoundLibrarySettings {
  getSelectedSoundId(): string | undefined;
  setSelectedSoundId(soundId: string | undefined): Promise<void>;
}

/**
 * Owns the catalog of built-in and user-added sounds. It stores only metadata;
 * actual playback remains the AudioManager's responsibility.
 */
export class SoundLibraryManager implements vscode.Disposable {
  private readonly builtInSounds: ProducerTag[];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private userSounds: ProducerTag[];

  public readonly onDidChange = this.changeEmitter.event;

  constructor(
    extensionUri: vscode.Uri,
    private readonly storage: vscode.Memento,
    private readonly settings: SoundLibrarySettings,
  ) {
    this.builtInSounds = [
      this.createBuiltInSound(
        extensionUri,
        "builtin-demo-1",
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
    ];
    this.userSounds = this.loadUserSounds();
  }

  public getBuiltInSounds(): readonly ProducerTag[] {
    return [...this.builtInSounds];
  }

  public getUserSounds(): readonly ProducerTag[] {
    return [...this.userSounds];
  }

  public getAllSounds(): readonly ProducerTag[] {
    return [...this.builtInSounds, ...this.userSounds];
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

    const sound: ProducerTag = {
      id: `user-${randomUUID()}`,
      name: path.basename(filePath, extension),
      filePath: path.resolve(filePath),
      source: "user",
    };

    this.userSounds = [...this.userSounds, sound];
    await this.persistUserSounds();
    this.changeEmitter.fire();
    return sound;
  }

  public async removeUserSound(id: string): Promise<ProducerTag> {
    const sound = this.userSounds.find((candidate) => candidate.id === id);

    if (!sound) {
      throw new Error("Only user-added producer tags can be removed.");
    }

    this.userSounds = this.userSounds.filter(
      (candidate) => candidate.id !== id,
    );
    await this.persistUserSounds();

    if (this.settings.getSelectedSoundId() === id) {
      await this.settings.setSelectedSoundId(undefined);
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
        (value as ProducerTag).source === "user",
    );
  }

  private async persistUserSounds(): Promise<void> {
    await this.storage.update(userSoundsStorageKey, this.userSounds);
  }
}
