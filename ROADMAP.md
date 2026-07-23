# Coder Tag — Roadmap

This roadmap sequences the work from the current push-detection MVP up to a full
online sound-pack platform. It is grounded in the existing architecture so each
phase names the real files and abstractions it touches. Treat it as a living
document — reorder, cut, or re-scope phases as priorities change.

Effort sizing is relative: **S** ≈ a few days, **M** ≈ 1–2 weeks, **L** ≈ a
month+, **XL** ≈ multi-month / needs a backend and possibly help.

---

## Guiding principles

- **Zero user setup stays the default.** Detection must keep working with no
  hooks and no per-repo configuration.
- **Reuse the pipeline.** Everything flows through
  `detector → handler → AudioManager`. New features plug into that seam rather
  than replacing it.
- **Degrade gracefully.** Internal/private APIs are always feature-detected;
  network features must work offline (or fail quietly).
- **Respect licensing.** Producer tags are frequently copyrighted. Every pack
  carries explicit license metadata, and the online gallery must be able to
  enforce and take down content (see [Cross-cutting: Legal](#legal--licensing)).

---

## Phase 0 — Current state (done)

Auto-detection of a successful `git push`, zero setup, cross-platform:

- `CompositePushDetector` fans in `TerminalPushDetector`
  (`window.onDidEndTerminalShellExecution`, exit code 0),
  `GitOperationPushDetector` (git extension's internal `onDidRunOperation`,
  `kind === "Push"`; `Sync` gated by `coderTag.syncCountsAsPush`), and
  `GitPublishPushDetector` (public `onDidPublish` fallback).
- One selected sound, played via the cross-platform `AudioManager` /
  `PlatformAudioPlayer`.

Key files: `src/git/*`, `src/audio/*`, `src/sounds/*`, `src/settings/settings.ts`.

---

## Phase 1 — Multi-operation detection (pull / merge / fetch / …)  ·  **M**

Goal: detect more git actions and let each play its own sound.

### 1.1 Generalize the event model  ·  S
- Rename/extend `PushEvent` → `GitActionEvent` with an `action` field:
  `"push" | "pull" | "fetch" | "merge" | "sync" | …`. Keep `source`
  (`terminal | git-operation | git-publish | manual`) and `repositoryRoot`.
  - File: `src/git/pushDetector.ts`. Keep a `PushEvent` type alias during
    migration so nothing downstream breaks at once.
- `PushHandler` → `GitActionHandler`: look up the sound for `event.action`
  instead of always `playSelectedTag()`. File: `src/git/pushHandler.ts`.

### 1.2 Generalize the two detectors  ·  S–M
- **Git operation detector:** replace the single `PUSH_OPERATION_KINDS` set with
  a config-driven map from `operation.kind` → action. `onDidRunOperation`
  already surfaces `Pull`, `Fetch`, `Merge`, `Sync`, `Commit`, `Checkout`, etc.
  File: `src/git/gitOperationPushDetector.ts` → `gitOperationDetector.ts`.
- **Terminal detector:** generalize `isGitPushCommand()` into
  `matchGitSubcommand(commandLine): "push" | "pull" | "fetch" | "merge" | undefined`
  reusing the same tokenizer (git-invocation detection, global-option skipping,
  compound-command splitting). File: `src/git/gitPushCommandMatcher.ts`.

### 1.3 Per-action sound mapping + settings  ·  S
- Settings: move from one `selectedSound` to a map, e.g.
  `coderTag.actionSounds: { push: "<id>", pull: "<id>", … }`, plus per-action
  enable flags. File: `src/settings/settings.ts`, `package.json` configuration.
- Commands: "Select sound for action…" quick pick (action → sound).

### 1.4 Guardrails per action
- **Fetch** is read-only and fires often (auto-fetch every few minutes) →
  default **off** to avoid noise.
- **Merge** can be a purely local operation → make clear it's not a remote sync.
- **Sync** already = pull+push in one op; decide whether it maps to the push
  sound, the sync sound, or both (today: push sound via `syncCountsAsPush`).
- Keep the existing dedupe window; extend the key to `repoRoot + action`.

**Deliverable:** each git action can trigger a distinct (or shared) sound, still
zero-setup, with sensible defaults.

---

## Phase 2 — Local sound packs & in-extension gallery  ·  **M–L**

Goal: move from loose individual sounds to installable **packs**, and give the
extension a real browsing UI.

### 2.1 Pack format  ·  S
Define a versioned manifest so packs are portable and shareable. Proposed
`coder-tag-pack.json`:

```jsonc
{
  "formatVersion": 1,
  "id": "acme.synthwave",          // globally unique (publisher.name)
  "name": "Synthwave Tags",
  "version": "1.2.0",
  "author": "Acme",
  "license": "CC-BY-4.0",          // required; see Legal section
  "description": "Retro synth stabs for your git actions.",
  "sounds": [
    { "id": "push",  "file": "push.wav",  "name": "Push Stab" },
    { "id": "pull",  "file": "pull.mp3",  "name": "Pull Pad" }
  ],
  "defaultMappings": { "push": "push", "pull": "pull" }  // action → sound id
}
```
Distribute as a `.zip` (manifest + audio). Keep sound files `.mp3`/`.wav` to
reuse `PlatformAudioPlayer` unchanged.

### 2.2 Pack management  ·  M
- Extend `SoundLibraryManager` (`src/sounds/soundLibraryManager.ts`) and
  `ProducerTag` (`src/sounds/producerTag.ts`) to model packs: a pack owns many
  sounds; sounds belong to a pack (built-in, user, or downloaded).
- Storage: unpack into `globalStorage/<pack-id>/` with the manifest; keep an
  index in `globalState`.
- Operations: import pack (`.zip`), export pack, create pack from local files,
  set active pack, remove pack, validate manifest on import.
- Migration: wrap the current single-sound selection into a "Default" pack so
  existing users lose nothing.

### 2.3 In-extension gallery UI  ·  M
- Add a **Webview** panel ("Coder Tag: Sound Gallery") — the quick-pick UI can't
  do grids/previews/search. New file: `src/ui/galleryView.ts` (+ webview HTML/JS
  assets under `media/`).
- Features: browse installed packs & sounds, preview-play, assign a sound to an
  action, switch active pack, drag-drop import.
- Security: strict webview CSP; the webview talks to the extension host via
  `postMessage` only; the host owns all file/audio access.
- Keep the status-bar menu (`src/ui/statusBar.ts`) as the quick entry point that
  opens the panel.

**Deliverable:** users assemble/import/switch themed packs and manage everything
from a proper panel — entirely local, no network needed.

---

## Phase 3 — Online sound gallery (web app + backend + extension integration)  ·  **XL**

Goal: a hosted library where users browse, search, download, upload, and share
packs — usable both from a web app and from inside the extension.

Ship this as **sub-phases**, smallest useful slice first.

### 3.a Read-only public gallery (no accounts)  ·  L
- Backend: a catalog API (`GET /packs`, `GET /packs/:id`, search/filter/tags)
  and signed download URLs. Curated/seeded packs only at first.
- Web app: browse/search/preview/download.
- **Extension integration:** a "Browse Online" tab in the Phase-2 gallery
  webview that calls the same API, previews, and one-click **downloads →
  installs** a pack locally (reusing Phase-2 import). No login required.
- This slice delivers most of the user value with the least platform risk.

### 3.b Accounts + uploads + publishing  ·  L–XL
- Auth: user accounts (email/OAuth). In the extension use a device-code / PKCE
  flow so users never paste passwords into VS Code (comply with credential
  handling rules — the extension should open the browser to authenticate).
- Uploads: upload sounds/packs via web app **and** "Publish pack" from the
  extension. Server-side validation: format, size limits, audio
  transcode/normalize, malware scan, license required.
- Personal library: signed-in users sync owned/downloaded packs across machines.
- Social/discovery: tags, ratings, download counts, collections, "featured".

### 3.c Suggested tech (recommendation, not a mandate)
- **Frontend:** Next.js + React (SSR for SEO on public pack pages).
- **Backend/BaaS:** Supabase (Postgres + Auth + Storage + edge functions) for a
  fast MVP, or a custom Node/TypeScript API if you outgrow it. Keeping it TS
  end-to-end lets the extension and web app share types.
- **Audio storage/CDN:** object storage (Supabase Storage / Cloudflare R2 / S3)
  behind a CDN; store normalized derivatives + originals.
- **Shared package:** a `@coder-tag/pack-schema` npm package with the manifest
  types + validators, imported by the extension, web app, and API so the format
  never drifts.

**Deliverable:** a discoverable, community-driven library reachable from the web
and from the extension, with safe uploads and cross-device sync.

---

## Cross-cutting concerns

### Legal / licensing
> Highest-risk item for Phase 3. Real producer tags (e.g. artist drops) are
> copyrighted/trademarked. A gallery hosting user uploads invites infringement.

- Require a `license` field on every pack; surface it in the UI; block uploads
  without one.
- Steer users toward **original or Creative-Commons / royalty-free** audio;
  provide original starter packs (the repo already ships original synth tones).
- Have a takedown/DMCA process, reporting, and moderation before enabling public
  uploads (3.b). Consider review-before-publish initially.
- Clear Terms of Service and content policy.

### Security
- Webview: strict CSP, no remote code, `postMessage`-only bridge, host owns FS.
- Downloads: validate manifest + file types, cap sizes, never execute anything;
  treat all downloaded content as untrusted data.
- Auth: browser-based flow; never handle raw passwords in the extension.

### Format & compatibility
- Version the pack manifest (`formatVersion`) and the gallery API; the extension
  must handle older/newer packs gracefully.
- Keep audio to `.mp3`/`.wav` so the existing cross-platform player is reused;
  document Linux `ffplay`/`pw-play`/`paplay`/`aplay` fallbacks for MP3.

### Ops / product
- Costs: storage + CDN bandwidth scale with popularity — budget before 3.b.
- Privacy: accounts imply GDPR duties (data export/delete, minimal PII).
- Telemetry: opt-in only; useful for "most popular packs" without tracking users.
- Accessibility & i18n for the web app and webview.

---

## Suggested sequencing

1. **Phase 1** (multi-operation detection) — highest value, lowest risk, no new
   infra. Do this next.
2. **Phase 2** (local packs + in-extension gallery webview) — unlocks the UX the
   later web features depend on; still fully offline.
3. **Phase 3.a** (read-only online gallery + in-extension browse/download) — the
   first networked slice; big value, limited platform risk.
4. **Phase 3.b** (accounts, uploads, publishing) — only after moderation,
   licensing enforcement, and cost planning are in place.

Each phase is independently shippable; stop at any point and still have a
coherent product.

---

## Open questions (decide before the relevant phase)

- Phase 1: which actions ship first, and what are the default on/off states
  (fetch noise, local merge)?
- Phase 2: single active pack, or per-action mixing across packs?
- Phase 3: build on a BaaS (Supabase) for speed, or a custom API from day one?
- Phase 3: allow arbitrary user uploads, or curated/reviewed submissions only at
  launch (safer for licensing)?
- Monetization, if any (free, pro packs, creator payouts)? Affects accounts and
  legal early.
