import * as vscode from "vscode";
import { defaultSoundId } from "../sounds/producerTag";

const configurationSection = "coderTag";

/**
 * Reads and updates the user-facing settings contributed by the extension.
 */
export class SettingsManager implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly configurationSubscription: vscode.Disposable;

  public readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.configurationSubscription =
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(configurationSection)) {
          this.changeEmitter.fire();
        }
      });
  }

  public isEnabled(): boolean {
    return this.configuration.get<boolean>("enabled", true);
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    await this.configuration.update(
      "enabled",
      enabled,
      vscode.ConfigurationTarget.Global,
    );
  }

  public getSelectedSoundId(): string | undefined {
    return this.configuration.get<string>("selectedSound", defaultSoundId);
  }

  public async setSelectedSoundId(soundId: string | undefined): Promise<void> {
    await this.configuration.update(
      "selectedSound",
      soundId,
      vscode.ConfigurationTarget.Global,
    );
  }

  public getVolume(): number {
    const volume = this.configuration.get<number>("volume", 1);
    return Math.min(1, Math.max(0, volume));
  }

  public syncCountsAsPush(): boolean {
    return this.configuration.get<boolean>("syncCountsAsPush", true);
  }

  public async setVolume(volume: number): Promise<void> {
    const safeVolume = Math.min(1, Math.max(0, volume));
    await this.configuration.update(
      "volume",
      safeVolume,
      vscode.ConfigurationTarget.Global,
    );
  }

  public dispose(): void {
    this.configurationSubscription.dispose();
    this.changeEmitter.dispose();
  }

  private get configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(configurationSection);
  }
}
