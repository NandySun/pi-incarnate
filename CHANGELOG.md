# Changelog

All notable changes to this project are documented here.

## Unreleased

- Add responsive `auto`, `full`, and `compact` avatar display modes using the same `avatar.txt` asset.
- Right-align the full avatar and collapse narrow terminals to a status-only widget.
- Show normal usage help instead of an error for a bare `/incarnate` command.

## 0.1.0 - 2026-09-04

Initial release.

- Add strict Markdown character discovery and loading.
- Add session-scoped character activation and safe prompt injection.
- Add `/incarnate` list, use, off, status, mood, and avatar commands.
- Add sanitized, width-limited persistent ASCII avatar widgets.
- Add validated mood presets and explicitly declared preference forms.
- Add the original example character Mira with three blank preference forms.
- Add automated tests, RPC integration coverage, and a real Pi TUI smoke checklist.
