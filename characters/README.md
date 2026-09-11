# Character directories

This directory contains built-in characters shipped with the package. Personal characters are stored under `<PI_CODING_AGENT_DIR>/pi-incarnate/characters` (normally `~/.pi/agent/pi-incarnate/characters`) and override built-ins with the same id. Use the bare `/incarnate` command to create or edit a personal character without modifying the package.

Each immediate child directory is a character id. Ids use lowercase ASCII letters, digits, and interior hyphens.

Every character directory must contain a UTF-8 `CHARACTER.md` with a level-one character name and these non-empty level-two sections:

- `Identity`
- `Personality`
- `Speech Style`
- `Behavior`

Optional sections such as `Tools and Forms` and `Current Mood` are preserved verbatim and become part of the persona prompt. Declared forms and mood presets are validated by their dedicated loaders.

An optional `avatar.png` is the primary avatar on terminals with supported inline-image protocols. It is limited to 512 KiB, 2048 px per dimension, and 4,194,304 total pixels, with PNG structure and chunk checksums validated by the core extension. An optional `avatar.ansi` or `avatar.txt` provides the terminal-compatible fallback; ANSI takes precedence over plain text and may use only safe SGR foreground/background colors and resets. Both text formats are limited to 64 KiB, 16 lines, and 48 visible columns.
