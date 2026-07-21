import * as vscode from "vscode";
import { AudioManager } from "../audio/audioManager";
import { GitHookManager, HookStatus } from "../git/gitHookManager";
import { PushHandler } from "../git/pushHandler";
import { SettingsManager } from "../settings/settings";
import { ProducerTag } from "../sounds/producerTag";
import { SoundLibraryManager } from "../sounds/soundLibraryManager";

interface SoundQuickPickItem extends vscode.QuickPickItem {
  readonly sound: ProducerTag;
}

interface MenuQuickPickItem extends vscode.QuickPickItem {
  readonly command: string;
}

interface RepositoryQuickPickItem extends vscode.QuickPickItem {
  readonly repositoryRoot: string;
  readonly status: HookStatus;
}

/**
 * Registers user commands and translates UI choices into manager calls.
 */
export class CommandManager implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly audioManager: AudioManager,
    private readonly soundLibrary: SoundLibraryManager,
    private readonly settings: SettingsManager,
    private readonly pushHandler: PushHandler,
    private readonly gitHookManager: GitHookManager,
  ) {}

  public register(): void {
    this.registerCommand("coderTag.preview", () => this.preview());
    this.registerCommand("coderTag.selectSound", () => this.selectSound());
    this.registerCommand("coderTag.addSound", () => this.addSound());
    this.registerCommand("coderTag.removeSound", () => this.removeSound());
    this.registerCommand("coderTag.toggleEnabled", () => this.toggleEnabled());
    this.registerCommand("coderTag.testPush", () => this.testPush());
    this.registerCommand("coderTag.installPushHook", () =>
      this.installPushHook(),
    );
    this.registerCommand("coderTag.uninstallPushHook", () =>
      this.uninstallPushHook(),
    );
    this.registerCommand("coderTag.showMenu", () => this.showMenu());
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private registerCommand(
    command: string,
    action: () => Promise<void>,
  ): void {
    this.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        try {
          await action();
        } catch (error) {
          console.error(`Coder Tag: command ${command} failed.`, error);
          const message =
            error instanceof Error
              ? error.message
              : "Coder Tag could not complete that action.";
          void vscode.window.showErrorMessage(message);
        }
      }),
    );
  }

  private async preview(): Promise<void> {
    const sound = await this.pickSound("Choose a producer tag to preview");

    if (sound) {
      await this.audioManager.preview(sound);
    }
  }

  private async selectSound(): Promise<void> {
    const sound = await this.pickSound("Choose your producer tag");

    if (!sound) {
      return;
    }

    await this.soundLibrary.setSelectedSound(sound.id);
    void vscode.window.showInformationMessage(
      `Selected producer tag: ${sound.name}`,
    );
  }

  private async addSound(): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Add Producer Tag",
      filters: {
        "Audio Files": ["mp3", "wav"],
      },
    });

    if (!selection?.[0]) {
      return;
    }

    const sound = await this.soundLibrary.addLocalAudioFile(
      selection[0].fsPath,
    );
    void vscode.window.showInformationMessage(
      `Added producer tag: ${sound.name}`,
    );
  }

  private async removeSound(): Promise<void> {
    const sounds = this.soundLibrary.getUserSounds();

    if (sounds.length === 0) {
      void vscode.window.showInformationMessage(
        "There are no user-added producer tags to remove.",
      );
      return;
    }

    const items: SoundQuickPickItem[] = sounds.map((sound) => ({
      label: sound.name,
      description: "User sound",
      detail: sound.filePath,
      sound,
    }));
    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Choose a user-added producer tag to remove",
    });

    if (!selection) {
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Remove "${selection.sound.name}" from Coder Tag?`,
      { modal: true },
      "Remove",
    );

    if (confirmation !== "Remove") {
      return;
    }

    const removed = await this.soundLibrary.removeUserSound(
      selection.sound.id,
    );
    void vscode.window.showInformationMessage(
      `Removed producer tag: ${removed.name}`,
    );
  }

  private async toggleEnabled(): Promise<void> {
    const enabled = !this.settings.isEnabled();
    await this.settings.setEnabled(enabled);
    void vscode.window.showInformationMessage(
      `Coder Tag is now ${enabled ? "enabled" : "disabled"}.`,
    );
  }

  private async testPush(): Promise<void> {
    await this.pushHandler.handlePush({
      source: "manual",
      timestamp: Date.now(),
    });
  }

  private async installPushHook(): Promise<void> {
    const repository = await this.pickRepository(
      "Choose a repository for attempted-push detection",
      (status) =>
        status === "not-installed" || status === "existing-hook",
    );

    if (!repository) {
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Install Coder Tag's pre-push hook in "${repository.label}"? Existing hooks will be preserved and chained.`,
      { modal: true },
      "Install Hook",
    );

    if (confirmation !== "Install Hook") {
      return;
    }

    await this.gitHookManager.install(repository.repositoryRoot);
    void vscode.window.showInformationMessage(
      `Coder Tag push detection installed for ${repository.label}.`,
    );
  }

  private async uninstallPushHook(): Promise<void> {
    const repository = await this.pickRepository(
      "Choose a repository whose Coder Tag hook should be removed",
      (status) => status === "installed",
    );

    if (!repository) {
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Remove Coder Tag's pre-push hook from "${repository.label}"? Any preserved hook will be restored.`,
      { modal: true },
      "Uninstall Hook",
    );

    if (confirmation !== "Uninstall Hook") {
      return;
    }

    await this.gitHookManager.uninstall(repository.repositoryRoot);
    void vscode.window.showInformationMessage(
      `Coder Tag push detection removed from ${repository.label}.`,
    );
  }

  private async showMenu(): Promise<void> {
    const selectedSound = this.soundLibrary.getSelectedSound();
    const enabled = this.settings.isEnabled();
    const hookSummary = await this.getHookSummary();
    const menuItems: MenuQuickPickItem[] = [
      {
        label: "$(play) Preview a Producer Tag",
        command: "coderTag.preview",
      },
      {
        label: "$(music) Select Producer Tag",
        command: "coderTag.selectSound",
      },
      {
        label: "$(add) Add Producer Tag",
        command: "coderTag.addSound",
      },
      {
        label: "$(trash) Remove Producer Tag",
        command: "coderTag.removeSound",
      },
      {
        label: enabled ? "$(mute) Disable" : "$(unmute) Enable",
        command: "coderTag.toggleEnabled",
      },
      {
        label: "$(debug-start) Test Push Sound",
        command: "coderTag.testPush",
      },
      {
        label: "$(plug) Install Push Hook",
        description: hookSummary,
        command: "coderTag.installPushHook",
      },
      {
        label: "$(debug-disconnect) Uninstall Push Hook",
        command: "coderTag.uninstallPushHook",
      },
    ];

    const selection = await vscode.window.showQuickPick(menuItems, {
      title: "Coder Tag",
      placeHolder: selectedSound
        ? `Current: ${selectedSound.name}`
        : "No producer tag selected",
    });

    if (selection) {
      await vscode.commands.executeCommand(selection.command);
    }
  }

  private async pickSound(
    placeHolder: string,
  ): Promise<ProducerTag | undefined> {
    const items: SoundQuickPickItem[] = this.soundLibrary
      .getAllSounds()
      .map((sound) => ({
        label: `$(play) ${sound.name}`,
        description: sound.source === "builtin" ? "Built-in" : "User sound",
        detail: sound.source === "user" ? sound.filePath : undefined,
        sound,
      }));

    if (items.length === 0) {
      void vscode.window.showWarningMessage(
        "No producer tags are available.",
      );
      return undefined;
    }

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder,
    });
    return selection?.sound;
  }

  private async pickRepository(
    placeHolder: string,
    include: (status: HookStatus) => boolean,
  ): Promise<RepositoryQuickPickItem | undefined> {
    const roots = await this.gitHookManager.getOpenRepositoryRoots();

    if (roots.length === 0) {
      void vscode.window.showWarningMessage(
        "No open Git repositories were found.",
      );
      return undefined;
    }

    const items = await Promise.all(
      roots.map(async (repositoryRoot): Promise<RepositoryQuickPickItem> => {
        const status = await this.gitHookManager.getStatus(repositoryRoot);
        const normalizedRoot = repositoryRoot.replace(/[\\/]+$/, "");
        const label =
          normalizedRoot.split(/[\\/]/).pop() ?? normalizedRoot;

        return {
          label,
          description: this.describeHookStatus(status),
          detail: repositoryRoot,
          repositoryRoot,
          status,
        };
      }),
    );
    const matchingItems = items.filter((item) => include(item.status));

    if (matchingItems.length === 0) {
      void vscode.window.showInformationMessage(
        "No repositories match that hook action.",
      );
      return undefined;
    }

    if (matchingItems.length === 1) {
      return matchingItems[0];
    }

    return vscode.window.showQuickPick(matchingItems, { placeHolder });
  }

  private async getHookSummary(): Promise<string> {
    const roots = await this.gitHookManager.getOpenRepositoryRoots();

    if (roots.length === 0) {
      return "No open repositories";
    }

    const statuses = await Promise.all(
      roots.map((root) => this.gitHookManager.getStatus(root)),
    );
    const installedCount = statuses.filter(
      (status) => status === "installed",
    ).length;
    return `${installedCount}/${roots.length} open repositories installed`;
  }

  private describeHookStatus(status: HookStatus): string {
    switch (status) {
      case "installed":
        return "Coder Tag hook installed";
      case "existing-hook":
        return "Existing hook will be preserved";
      case "conflict":
        return "Hook conflict requires manual resolution";
      case "not-installed":
        return "No pre-push hook";
    }
  }
}
