# Coder Tag

[![CI](https://github.com/bornaBuilds/coder-tag/actions/workflows/ci.yml/badge.svg)](https://github.com/bornaBuilds/coder-tag/actions/workflows/ci.yml)
[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/bornaBuilds.coder-tag)](https://marketplace.visualstudio.com/items?itemName=bornaBuilds.coder-tag)

Coder Tag is a VS Code/Cursor extension that plays a producer-tag-style audio
clip after a successful Git push. It includes seven bundled sounds and supports
user-added MP3 and WAV files.

## Installation

Install **Coder Tag** from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=bornaBuilds.coder-tag)
or search for `Coder Tag` in the Extensions view.

To install a packaged build manually, download the VSIX artifact from a
**Package Extension** workflow run, then run **Extensions: Install from VSIX**
in VS Code or Cursor.

## Features

- Preview any available sound without changing your selection.
- Start immediately with Demo Tag 1 selected.
- Select from bundled sounds or imported MP3/WAV files.
- Keep imported sounds in extension-managed storage so moving the originals
  does not break playback.
- Remove user-added sounds and their managed copies without deleting the
  original files.
- Enable or disable push playback and control volume.
- Use the status bar menu for preview, selection, import, volume, and settings.
- Test the complete push-to-audio flow without relying on Git detection.

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
  It deletes Coder Tag's managed copy but never the original file. Bundled
  sounds cannot be removed.
- **Coder Tag: Toggle Enabled** enables or disables push playback.
- **Coder Tag: Set Volume** selects a playback level from 0% to 100%.
- **Coder Tag: Open Settings** opens the standard VS Code settings page filtered
  to Coder Tag.
- **Coder Tag: Test Push** sends a manual event through the same `PushHandler`
  used by automatic events.

Click the Coder Tag status bar item to open a menu containing these actions.

## Settings

- `coderTag.enabled`: enables or disables playback for push events.
- `coderTag.selectedSound`: stores the selected sound ID. Prefer the Select
  Producer Tag command instead of editing this value manually. A fresh install
  defaults to `builtin-demo-1`.
- `coderTag.volume`: playback volume from `0` to `1`.
- `coderTag.syncCountsAsPush`: when enabled (the default), the Source Control
  Sync button and auto-sync also play the tag. Because VS Code runs a push on
  every sync, this can also play when a sync had nothing to push; disable it to
  play only on an explicit push.

Settings and user-added sound metadata persist across restarts. Built-in sounds
are resolved relative to the installed extension. Imported sounds are copied
into the extension's global storage; existing external-path entries from
development builds are migrated automatically. Missing entries are removed
with a one-time warning and the selection falls back to an available bundled
sound.

## Git Push Detection

Coder Tag automatically detects a **successful** `git push` and plays your
selected tag. There are no git hooks to install and no per-project setup.

All events flow through one pipeline:

```text
Terminal push / Source Control push / First-time publish / Test Push
                          |
                          v
                 CompositePushDetector
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

Detection combines three complementary, built-in signals — all cross-platform
(Windows/macOS/Linux) and all reporting real success or failure:

- **Integrated terminal.** The Terminal Shell Integration API
  (`window.onDidEndTerminalShellExecution`, stable since VS Code 1.93) detects
  `git push` typed in VS Code's integrated terminal and plays only when the
  command exits successfully (exit code `0`). Command lines reported with low
  confidence are still checked by the strict Git command matcher, which keeps
  terminal detection working with customized zsh prompts.
- **Source Control UI.** The git extension's per-repository operation event —
  the same signal VS Code uses for its "Successfully pushed" notification —
  detects pushes from the Source Control panel and the `Git: Push` command,
  firing on a successful `Push` operation. This uses an internal API that is
  accessed defensively; if it is ever unavailable, the other detectors keep
  working. The Source Control **Sync** button and auto-sync (a pull followed by
  a push) are also detected when `coderTag.syncCountsAsPush` is enabled (the
  default); see Settings.
- **First-time publish.** The public `gitAPI.onDidPublish` event.

A short de-duplication window keeps a single push from playing the tag twice
when two signals observe it (for example, a first-time publish).

Use **Coder Tag: Test Push** to exercise the audio path without pushing. It
respects `coderTag.enabled` and uses exactly the same `PushHandler` as
automatic events.

### Terminal and zsh troubleshooting

Terminal detection depends on VS Code shell integration. Hover the terminal tab
and check that **Shell Integration** reports **Rich** or **Basic**. Open a new
terminal after changing shell settings or installing a new extension build.

Complex zsh configurations can prevent automatic shell-integration injection.
If needed, disable `terminal.integrated.shellIntegration.enabled` and add the
official manual integration line to `~/.zshrc`:

```zsh
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"
```

Restart the terminal after editing `.zshrc`. Shell aliases such as `gp` are not
detected; use an explicit `git push`. A VS Code zsh shell-integration issue can
also prevent the terminal completion event from firing. In that case Coder Tag
cannot confirm that the push succeeded; Source Control pushes and
**Coder Tag: Test Push** remain available.

## Bundled Sounds

The extension ships these sounds:

```text
media/demo-tag-1.wav
media/demo-tag-2.wav
media/demo-tag-3.wav
media/chat-gpt-made-it.mp3
media/metro-boomin-once-more.mp3
media/if-young-metro-dont-trust-you.mp3
media/coby-jesil-ti.mp3
```

The three WAV demos are original synthesized tones and can be regenerated with
`npm run generate-demo-sounds`. The repository owner has confirmed
redistribution rights for the four bundled MP3 clips. Do not add other
copyrighted audio unless you have permission to distribute it.

## Audio Playback Support

Coder Tag launches the host operating system's audio tools directly. It does
not pass file paths through a command shell, and starting a new producer tag
stops the one currently playing.

- macOS uses the built-in `/usr/bin/afplay` player.
- Windows uses PowerShell and the built-in PresentationCore media player.
- Linux tries `ffplay`, `pw-play`, `paplay`, and then `aplay`, in that order.

For the broadest Linux MP3/WAV and volume support, install FFmpeg so `ffplay`
is available. PipeWire's `pw-play` and PulseAudio's `paplay` are supported
fallbacks. ALSA's `aplay` is used only for WAV files and plays at the system
mixer volume rather than applying `coderTag.volume`.

If Linux reports that no audio backend is available, install one of those
players and restart the extension host. Audio runs on the machine hosting the
extension process, so Remote SSH, containers, and WSL need audio configured in
that environment.

## Packaging

### Package locally

```sh
npm ci
npm test
npm exec vsce package -- --no-yarn
```

The generated `.vsix` can be installed with **Extensions: Install from VSIX**.

### Package with GitHub Actions

The **Package Extension** workflow:

- Runs manually from **Actions → Package Extension → Run workflow**.
- Runs automatically when a version tag such as `v0.0.2` is pushed.
- Installs dependencies, compiles, lints, runs the extension tests, and packages
  `coder-tag-<version>.vsix`.
- Uploads the VSIX as a workflow artifact for 30 days.

For tag-triggered builds, update `package.json` and `CHANGELOG.md` first. The
workflow rejects a tag that does not match the extension version. Packaging
does not publish to the Marketplace and requires no Marketplace token.

## Current MVP Limitations

- Only pushes made through VS Code are detected: its integrated terminal, the
  Source Control UI, and publish events. Pushes from an **external** terminal
  (outside VS Code) or from another Git client/GUI are not detected.
- Terminal detection requires VS Code's shell integration to be active for the
  shell in use (automatic for bash, zsh, fish, PowerShell, and Git Bash). Shell
  aliases such as a `gp` alias for `git push` are not recognized, because the
  extension matches the command text that was run.
- Source Control UI push detection relies on an internal git-extension API. If a
  future VS Code release changes it, terminal and publish detection continue to
  work.
- Only `git push` is detected today. Support for pull/merge/fetch is planned and
  the detection layer is structured to add them.
- MP3 codec support can vary when Linux falls back from `ffplay` to the
  desktop audio utilities.
- Playback requires an audio device in the environment where the extension
  host is running.
- Imported sounds consume space in VS Code's extension global storage until
  removed through Coder Tag.
- The extension does not yet download online sound packs.
