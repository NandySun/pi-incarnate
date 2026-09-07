# Security

Pi extensions execute with the same system permissions as Pi. Review this package and every character card before installing content from an untrusted source.

`pi-incarnate` applies these local boundaries:

- Character IDs cannot contain path separators or traversal segments.
- Character directories and `CHARACTER.md` files cannot be symbolic links.
- Built-in package characters are never edited in place; menu edits create a personal override under the Pi configuration directory.
- Character-card writes are validated before an atomic replacement, and copied character resources reject symbolic links and non-regular files.
- Declared form paths must resolve to readable files inside their character directory.
- Form contents are never loaded or cached by the extension itself.
- Plain avatars have terminal control sequences removed. ANSI avatars use a strict SGR color-only allowlist; cursor movement, screen control, OSC, hyperlinks, and other escape sequences are removed. Both formats are byte-, line-, and width-limited, with a forced reset on every ANSI line.
- The optional UI protocol broadcasts only bounded character metadata and already-sanitized avatar lines. It does not expose the complete character-card body, and unknown protocol claims are ignored.
- The personality layer is appended without replacing Pi's existing tool, permission, or safety instructions, and explicitly tells the model to preserve those boundaries.

Do not include secrets in character cards or preference forms. A character can ask Pi to read an available declared form when relevant, so those files should contain only information you intend to expose to the active model.

For a private vulnerability report, contact the repository owner through the hosting platform once the public repository is established. Do not publish secrets or exploit details in a public issue.
