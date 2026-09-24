# Historical pr-orchestrate YAML fixture

`pr-orchestrate/SKILL.md` is the complete neutral package-source asset from tag
`v0.5.0-rc.1`, commit `6882bfd1b7ce35e4e1d1bf1ba9d44348341f0032`, path
`scaffold/codex/pr-orchestrate/SKILL.md`, Git blob
`7dfef7e2febadd50c8685208d1b785cccd81049c`. It is not pilot-derived or live workflow
state. Its unquoted description includes a colon followed by a space, producing
the historical YAML parse defect.

The upstream package-source correction at commit
`ad598b4a7896b9ea26dd057b5295d9a170e8782c` added only two double quotes; the corrected
blob is `8bc6d6c3991b25813280c4549fb0f9c282ace0be`. After normalizing CRLF to LF,
the complete historical asset hashes to
`b8ba7f40a0e5e1524a277652aef0fa940a19ca292c4ee2cb70633851fb501bfa` and the corrected
asset to `200a43bfc42d8843a3b3197f5c1f8e518b6aac6e234db100d67d86831cdbc790`.
The `repairs` entry in `src/application/install/codex-legacy-fingerprints.v1.json`
is the executable recognition ledger. It is content provenance, not native
Codex trust or proof that an arbitrary local file was installed by AIDN.

Keep the defect in this historical fixture. The focused verifier proves parsing
fails before repair, succeeds afterward, preserves description text and the whole
Markdown body, preserves LF/CRLF, is idempotent and rejects customized content.

The same complete-content fingerprint is recognized only at the two installed
locations `.agents/skills/pr-orchestrate/SKILL.md` and
`.codex/skills/pr-orchestrate/SKILL.md`. The latter is an explicitly allowlisted
legacy path, not authorization to adopt or replace the surrounding directory.
Unknown or customized content at either location is a conflict.
