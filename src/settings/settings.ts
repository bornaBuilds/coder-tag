import * as vscode from "vscode";

export class SettingsManager {
  /**
   * The VS Code configuration section
   * used by this extension
   */

  private readonly config = vscode.workspace.getConfiguration("coderTag");

  /**
   * Returns whether coder tags
   * are currently enabled.
   */
  public isEnabled(): boolean {
    return this.config.get<boolean>("enabled", true);
  }

  /**
   * Enable or disable coder tags.
   */
  public async setEnabled(enabled: boolean): Promise<void> {
    await this.config.update(
      "enabled",
      enabled,
      vscode.ConfigurationTarget.Global,
    );
  }

  /**
   * Returns the path of the currently
   * selected audio file.
   */
  public getSelectedSound(): string | undefined {
    return this.config.get<string>("audioFile");
  }

  /**
   * Saves the selected audio file.
   */
  public async setSelectedSound(filePath: string): Promise<void> {
    await this.config.update(
      "audioFile",
      filePath,
      vscode.ConfigurationTarget.Global,
    );
  }
}
