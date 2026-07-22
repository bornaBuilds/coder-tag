# Change Log

All notable changes to the "coder-tag" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.1] - 2026-07-22

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
- Added deterministic clean builds, Marketplace metadata, and CI packaging
  validation.