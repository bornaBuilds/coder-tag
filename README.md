# Coder Tag

Coder Tag is a VS Code/Cursor extension that plays a producer-tag-style audio
clip when code is published. It includes three original demo tones and supports
user-added MP3 and WAV files.

## Features

- Preview any available sound without changing your selection.
- Select from bundled demo sounds or local MP3/WAV files.
- Remove user-added sounds without deleting the original files.
- Enable or disable push playback and control volume.
- Use the status bar menu for common actions.
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
  It never deletes the original file, and bundled sounds cannot be removed.
- **Coder Tag: Toggle Enabled** enables or disables push playback.
- **Coder Tag: Test Push** sends a manual event through the same `PushHandler`
  used by automatic events.

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
PushDetector or Test Push command
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
Coder Tag uses only the verified `gitAPI.onDidPublish` event, which fires when
VS Code publishes a repository or branch for the first time. It does not call
the unsupported `onDidRunOperation` method and does not treat remote-tracking
ref changes as proof of a push.

Use **Coder Tag: Test Push** to reliably exercise ordinary push behavior in V1.
The command respects `coderTag.enabled` and uses exactly the same `PushHandler`
as automatic publish events.

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

- Ordinary `git push` commands are not automatically detected because the
  supported Git and terminal APIs available to this extension cannot identify
  them reliably. Terminal aliases, external terminals, and other Git clients
  make command interception incomplete.
- Automatic playback currently covers only VS Code's first-time Git publish
  event. Test Push is the reliable test path.
- MP3 codec support can vary when Linux falls back from `ffplay` to the
  desktop audio utilities.
- Playback requires an audio device in the environment where the extension
  host is running.
- User sound paths are absolute. Moving or deleting a file makes it unavailable
  until it is re-added.
- The extension does not yet download online sound packs.
