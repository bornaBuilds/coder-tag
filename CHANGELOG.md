# Change Log

All notable changes to Coder Tag are documented in this file. This project
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.2] - 2026-07-23

### Added

- Added a dedicated **Package Extension** GitHub Actions workflow that validates
  the extension and uploads a versioned VSIX for manual runs and `v*` tags.
- Added installation, automated packaging, and zsh shell-integration
  troubleshooting documentation.

### Fixed

- Allowed successful low-confidence terminal command lines through the strict
  `git push` matcher, restoring detection for customized zsh prompts when VS
  Code reports the completed command from its terminal buffer.

## [0.0.1] - 2026-07-22

### Added

- Added automatic, zero-setup detection of successful `git push`:
  - Terminal pushes via the Terminal Shell Integration API (plays only on a
    successful exit).
  - Source Control UI pushes via the git extension's operation event
    (accessed defensively with graceful degradation).
  - Detection of the Source Control Sync button / auto-sync, controlled by the
    new `coderTag.syncCountsAsPush` setting (default on).
  - Kept first-time publish detection as a public-API fallback.
  - Combined all detectors behind a `CompositePushDetector` that de-duplicates
    a single push observed by more than one signal.
- Added built-in demo tags and persistent local MP3/WAV sound management.
- Added preview, selection, removal, enable/disable, and Test Push commands.
- Added the status bar menu and configurable playback volume.
- Added a verified Git publish detector behind the PushDetector abstraction.
- Added cross-platform playback through native macOS and Windows facilities
  plus ordered Linux audio-player fallbacks.
- Added stoppable playback and safe process arguments for local audio paths.
- Added a first-run default sound, direct volume and settings actions, and
  clearer status bar state.
- Added extension-managed storage, migration, duplicate detection, and
  missing-file recovery for custom sounds.
- Added deterministic clean builds, Marketplace metadata, and CI validation.
