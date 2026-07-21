import * as vscode from "vscode";
import { SettingsManager } from "../settings/settings";
import { SoundLibraryManager } from "../sounds/soundLibraryManager";

/**
 * Presents the current Coder Tag state and opens the command menu when clicked.
 */
export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly settings: SettingsManager,
    private readonly soundLibrary: SoundLibraryManager,
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = "Coder Tag";
    this.item.command = "coderTag.showMenu";

    this.subscriptions = [
      this.settings.onDidChange(() => this.update()),
      this.soundLibrary.onDidChange(() => this.update()),
    ];

    this.update();
    this.item.show();
  }

  public update(): void {
    if (!this.settings.isEnabled()) {
      this.item.text = "$(mute) Tag: Disabled";
      this.item.tooltip = "Coder Tag is disabled. Click for options.";
      return;
    }

    const selectedSound = this.soundLibrary.getSelectedSound();

    if (!selectedSound) {
      this.item.text = "$(unmute) Tag: Select Sound";
      this.item.tooltip = "No producer tag selected. Click for options.";
      return;
    }

    this.item.text = `$(unmute) Tag: ${selectedSound.name}`;
    this.item.tooltip = `Coder Tag is enabled with ${selectedSound.name}.`;
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.item.dispose();
  }
}
