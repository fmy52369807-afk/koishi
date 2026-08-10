# Security and Privacy

## Supported public branch

`main` is the public release branch. Feature branches may contain unreleased work and must not be represented as released functionality.

## Secret handling

- Copy `.env.example` to `.env`; never commit `.env`.
- Keep provider keys in environment variables only. The repository does not need a key for tests, benchmarks, or demo fixtures.
- Rotate a credential immediately if it has ever been pasted into a chat, issue, log, commit, screenshot, or CI output.
- `yarn audit:public` scans tracked text files for common credential formats and intentionally prints file names and rule names only, never matched values.

## Minimum permissions

- Give the OneBot account only the group and private-message permissions required for the intended deployment.
- Keep proactive replies, user-profile collection, and history injection limited through `ACTIVELINK_GROUP_IDS`, `PROACTIVE_CONTEXT_GROUPS`, and `ACTIVELINK_PRIVATE_IDS`.
- Restrict `/公主学习` to Koishi authority level `3` or higher.
- Bind the Koishi console to `127.0.0.1` unless a firewall or authenticated reverse proxy protects the service.

## Data boundary

`data/koishi2.db`, local vector files, library documents, media, logs, and `.env` may contain personal or third-party data. They are runtime artifacts and are intentionally ignored by Git. Do not use them in public demos, issues, screenshots, or releases.

## Reporting

Do not open a public issue for a suspected secret or privacy exposure. Contact the repository owner through a private GitHub channel, include the affected file path or commit hash, and redact all credential values.
