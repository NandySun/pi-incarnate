# Changelog

All notable changes to this project are documented here.

## Unreleased

- Add responsive `auto`, `full`, and `compact` avatar display modes using the same `avatar.txt` asset.
- Right-align the full avatar with its final line sharing the status row, and collapse narrow terminals to a status-only widget.
- Show normal usage help instead of an error when `/incarnate` is invoked without an interactive UI.
- Turn bare `/incarnate` into a keyboard-navigable menu for character, mood, avatar, status, and disable actions.
- Add guided character creation and editing with Pi's multiline editor, full validation, and atomic saves.
- Store personal characters outside the npm package and let them override same-id built-in characters.

## 0.1.0 - 2026-09-04

Initial release.

- Add strict Markdown character discovery and loading.
- Add session-scoped character activation and safe prompt injection.
- Add `/incarnate` list, use, off, status, mood, and avatar commands.
- Add sanitized, width-limited persistent ASCII avatar widgets.
- Add validated mood presets and explicitly declared preference forms.
- Add the original example character Mira with three blank preference forms.
- Add automated tests, RPC integration coverage, and a real Pi TUI smoke checklist.
