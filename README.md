# Coder Tag

Coder Tag is a VS Code/Cursor extension that plays a producer-tag-style audio
clip when you attempt to push code. It includes three original demo tones and
supports user-added MP3 and WAV files.

## Features

- Preview any available sound without changing your selection.
- Select from bundled demo sounds or local MP3/WAV files.
- Remove user-added sounds without deleting the original files.
- Enable or disable push playback and control volume.
- Use the status bar menu for common actions.
- Test the complete push-to-audio flow without relying on Git detection.
- Install a cross-platform Git `pre-push` hook for automatic detection.

## Run Locally

1. Install dependencies with `npm install`.
2. Open this repository in VS Code or Cursor.
3. Press `F5` and choose **Run Extension** if prompted.
4. In the Extension Development Host, open the Command Palette.
5. Run **Coder Tag: Select Producer Tag**, then **Coder Tag: Test Push**.

The default build task runs the TypeScript watcher. You can also run:

```sh
npm run compile
npm run lint
npm test
```

## Commands

- **Coder Tag: Preview Producer Tag** chooses and plays a sound without saving
  it as the current sound.
- **Coder Tag: Select Producer Tag** saves a sound as the current selection.
- **Coder Tag: Add Sound** adds a local `.mp3` or `.wav` file.
- **Coder Tag: Remove Sound** removes user-added metadata after confirmation.
  It never deletes the original file, and bundled sounds cannot be removed.
- **Coder Tag: Toggle Enabled** enables or disables push playback.
- **Coder Tag: Test Push** sends a manual event through the same `PushHandler`
  used by automatic events.
- **Coder Tag: Install Push Hook** enables attempted-push detection for an open
  repository after confirmation.
- **Coder Tag: Uninstall Push Hook** removes Coder Tag's dispatcher and restores
  any hook that was preserved during installation.

Click the Coder Tag status bar item to open a menu containing these actions.

## Settings

- `coderTag.enabled`: enables or disables playback for push events.
- `coderTag.selectedSound`: stores the selected sound ID. Prefer the Select
  Producer Tag command instead of editing this value manually.
- `coderTag.volume`: playback volume from `0` to `1`.

Settings and user-added sound metadata persist across restarts. Built-in sounds
are resolved relative to the installed extension. User sounds keep their
original absolute paths for this MVP.

## Git Push Detection

All events use one pipeline:

```text
Pre-push hook, Git publish event, or Test Push command
              |
              v
          PushHandler
              |
              v
         AudioManager
              |
              v
       Selected Producer Tag
```

The VS Code 1.93 public Git API does not expose a general successful-push event.
Coder Tag therefore offers an opt-in client-side `pre-push` hook. Run **Coder
Tag: Install Push Hook** once for each repository where detection is wanted.
The hook runs for pushes started through the Source Control UI, Command Palette,
integrated terminal, or another Git client using that repository.

The hook fires before Git transfers objects. It proves that a push was
attempted, not that the remote accepted it. Failed, rejected, and cancelled
pushes may still play the sound. The hook writes a small event file containing
the repository root; the extension consumes it and sends one `PushEvent` to the
shared `PushHandler`.

Installation uses `git rev-parse --git-path hooks`, so worktrees and configured
hook directories are respected. If a `pre-push` hook already exists, Coder Tag
preserves it byte-for-byte and invokes it with the original arguments and
standard input. Uninstall restores that hook. Coder Tag refuses to overwrite
hook files that changed unexpectedly.

The hook is a portable `#!/bin/sh` script. Git for Windows supplies the shell
used for hooks, so the same dispatcher works on Windows, macOS, and Linux.
First-time VS Code publish events remain a fallback and are deduplicated against
hook events.

Coder Tag does not call the unsupported `onDidRunOperation` method and does not
treat remote-tracking ref changes as proof of a push. Use **Coder Tag: Test
Push** to exercise the same handler without changing repository hooks.

## Bundled Demo Sounds

The files in `media/` are short, original synthesized WAV tones:

```text
media/demo-tag-1.wav
media/demo-tag-2.wav
media/demo-tag-3.wav
```

Run `npm run generate-demo-sounds` to regenerate them. To use different
development assets, place MP3 or WAV files in `media/` and update the built-in
entries in `src/sounds/soundLibraryManager.ts`. Do not use copyrighted producer
tags unless you have permission to distribute them.

## Packaging

1. Replace `your-publisher-id` in `package.json` with your Visual Studio
   Marketplace publisher ID.
2. Compile and lint the extension.
3. Install or invoke VSCE and build the package:

```sh
npm run compile
npm run lint
npx @vscode/vsce package
```

The generated `.vsix` can be installed with **Extensions: Install from VSIX**.

## Current MVP Limitations

- Hook installation is opt-in and must be performed for each repository.
- A `pre-push` event means a push was attempted; it cannot confirm success.
- Hook conflicts require manual resolution instead of risking user files.
- A changed extension storage location can require manual hook conflict
  resolution so Coder Tag does not overwrite an older installation.
- `sound-play` depends on operating-system playback facilities. MP3/WAV codec
  support can vary by system.
- `sound-play` has no reliable cross-platform stop API, so `stop()` is a no-op.
- User sound paths are absolute. Moving or deleting a file makes it unavailable
  until it is re-added.
- The extension does not yet download online sound packs.
