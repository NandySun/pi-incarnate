# Changelog

All notable changes to this project are documented here.

## Unreleased

- Move all on-screen avatar presentation to the optional `pi-incarnate-ui` companion; core now only publishes sanitized character presentation data.
- Add `auto`, `full`, `compact`, and `off` presentation preferences for companion UIs, all using the same avatar asset.
- Add `avatar.ansi` support with a strict SGR color allowlist, per-line resets, a 64 KiB limit, and a 16-line display limit.
- Add a versioned, read-only UI state protocol so companion extensions can render presentation without duplicating character or ANSI parsing.
- Show normal usage help instead of an error when `/incarnate` is invoked without an interactive UI.
- Turn bare `/incarnate` into a keyboard-navigable menu for character, mood, avatar, status, and disable actions.
- Add guided character creation and editing with Pi's multiline editor, full validation, and atomic saves.
- Ask for the display name first, suggest a safe character id, normalize common id formatting, and retry invalid input in place.
- Store personal characters outside the npm package and let them override same-id built-in characters.
- Add a keyboard-driven repair flow for malformed or missing personal `CHARACTER.md` files, with the same validation and atomic-save guarantees as normal edits.
- Reject symbolic-link `CHARACTER.md` files before reading them.
- Add keyboard-driven avatar import and removal for personal characters, including safe path normalization, ANSI sanitization, lossless bounds checks, and built-in character overrides.

## 0.1.0 - 2026-09-04

Initial release.

- Add strict Markdown character discovery and loading.
- Add session-scoped character activation and safe prompt injection.
- Add `/incarnate` list, use, off, status, mood, and avatar commands.
- Add sanitized, width-limited persistent ASCII avatar widgets.
- Add validated mood presets and explicitly declared preference forms.
- Add the original example character Mira with three blank preference forms.
- Add automated tests, RPC integration coverage, and a real Pi TUI smoke checklist.
