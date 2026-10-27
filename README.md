**English** · [简体中文](./README.zh-CN.md)

# pi-session-title

Two live footer chips: what this session is about, and what it is doing
right now.

```
◆ refactor login module · Last 3: switch to docker compose deploy
```

- **`◆ topic`** — derived from the first user message; `/topic <name>` to
  rename, `/topic clear` to remove; restored on resume
- **`Last 3:`** — after each turn, a cheap model summarizes the recent
  Q&A rounds into one topic phrase; follows topic drift

Renders via `ctx.ui.setStatus()`, so it coexists with any custom footer.
With pi-cc-extensions, dedicate a line:

```jsonc
{ "footerLine3Keys": ["session-topic", "recent-topic"] }
```

## Summary model — explicit, no surprise spend

Selection order:

1. `PI_TOPIC_SUMMARY_MODELS="provider/id,provider/id"` — explicit candidates,
   first configured wins
2. Fallback: the active session model (already in use, zero extra cost)

The extension never auto-picks from the model registry: a heuristic could
silently select a paid model you never intended to call.

Network failure falls back to a heuristic (last user message); the chip
never breaks.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `PI_TOPIC_SUMMARY_MODELS` | — | comma-separated `provider/id` candidates |
| `PI_TOPIC_ROUNDS` | `3` | Q&A rounds feeding the summary (1–10) |

## Notes

- The topic is **never persisted as the session name** — Pi writes session
  names into the terminal tab title, and this extension keeps the tab clean.
- The summary call uses no prompt caching and a fresh session id.

## Install

```bash
pi install git:github.com/codelllc09/pi-session-title
```

## License

0BSD — do whatever you want, no attribution required.
