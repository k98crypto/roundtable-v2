# Roundtable v2 — local multi-agent meeting CLI

A personal, local-first way to run several AI agents as a meeting: each agent
gets a seat, speaks in turn, and everything lands in one folder that is the
single source of truth. No server, no public exposure.

## What it is

- `cli.mjs` — the main channel: post messages, create tasks, read the meeting
  back. One writer at a time.
- `server.mjs` — a small HTTP bridge (default `127.0.0.1:3176`) so other tools
  can post without touching the files directly.
- `lib/` — meeting logic (topics, turns, seats), gateway and mobile helpers.
- `public/` — a minimal web view of the meeting.
- `skills/` — skill notes the seats share.
- `tests/` — 18/18 passing locally at deploy time.

## Layout on disk

```
01_议题 / 02_会议记录 / 03_任务分工 / 04_成果 / 05_铁律 / 06_工具
Agent输出 / jobs / meetings.json
```

Meetings are stored as folders plus `meetings.json`. Summaries travel with
deep links; full transcripts stay local.

## Quick start

```bash
node cli.mjs --help
node server.mjs   # bridge on 127.0.0.1:3176
```

Node 18+ is enough for the CLI; the bridge needs no extra dependencies.

## Notes

- Built for one person's Windows PC; paths and seats are configured for that
  setup. Adapt `lib/` to your own seats before using it elsewhere.
- Deployment notes from the original rollout are kept in
  `docs/DEPLOY-NOTES.md`.

## License

MIT — see `LICENSE`.
