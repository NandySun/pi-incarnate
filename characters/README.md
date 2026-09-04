# Character directories

Each immediate child directory is a character id. Ids use lowercase ASCII letters, digits, and interior hyphens.

Every character directory must contain a UTF-8 `CHARACTER.md` with a level-one character name and these non-empty level-two sections:

- `Identity`
- `Personality`
- `Speech Style`
- `Behavior`

Optional sections such as `Tools and Forms` and `Current Mood` are preserved verbatim and become part of the persona prompt. They are not interpreted by the M1 loader yet.
