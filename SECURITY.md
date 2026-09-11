# Security

Pi extensions execute with the same system permissions as Pi. Review this package and every character card before installing content from an untrusted source.

`pi-incarnate` applies these local boundaries:

- Character IDs cannot contain path separators or traversal segments.
- Character directories and `CHARACTER.md` files cannot be symbolic links.
- Built-in package characters are never edited in place; menu edits create a personal override under the Pi configuration directory.
- Character-card writes are validated before an atomic replacement, and copied character resources reject symbolic links and non-regular files.
- Guided card edits replace only the selected top-level name or level-two section, reject ambiguous duplicates and structural heading injection, and pass through the same complete-card validation and atomic replacement as full edits.
- Character lifecycle actions operate only on direct personal-character directories. Archive storage must be a real directory, moves refuse existing targets, and the menu exposes recovery instead of permanent deletion.
- Portable character packages include only the card, one validated PNG primary avatar, one validated ANSI/TXT fallback, and available forms explicitly declared by that card. Binary PNG data uses explicit base64 encoding. Imports reject unknown, duplicate, escaping, oversized, malformed-encoding, non-UTF-8, and symbolic-link inputs, build in a temporary personal directory, and never overwrite an existing personal character.
- Declared form paths must resolve to readable files inside their character directory.
- Form contents are not loaded or cached during character activation or prompt composition. They are read only after an explicit `Manage preference forms` action, with UTF-8, regular-file, path-containment, and 256 KiB editor bounds.
- Plain avatars have terminal control sequences removed. ANSI avatars use a strict SGR color-only allowlist; cursor movement, screen control, OSC, hyperlinks, and other escape sequences are removed. Both formats are byte-, line-, and width-limited, with a forced reset on every ANSI line.
- PNG avatars are limited to 512 KiB, 2048 px per dimension, and 4,194,304 total pixels. Imports validate the PNG signature, IHDR fields, required chunks, and declared dimensions before preserving the binary bytes.
- Avatar imports reject symbolic-link and non-regular sources, invalid UTF-8, malformed PNG data, oversized files, and text resources that would require display truncation. Only the validated or sanitized result is written to a personal character directory.
- The optional UI protocol broadcasts only bounded character metadata, already-sanitized avatar lines, and validated PNG bytes encoded as base64. It does not expose the complete character-card body, and unknown protocol claims are ignored.
- The personality layer is appended without replacing Pi's existing tool, permission, or safety instructions, and explicitly tells the model to preserve those boundaries.

Do not include secrets in character cards or preference forms. A character can ask Pi to read an available declared form when relevant, so those files should contain only information you intend to expose to the active model.

For a private vulnerability report, contact the repository owner through the hosting platform once the public repository is established. Do not publish secrets or exploit details in a public issue.
