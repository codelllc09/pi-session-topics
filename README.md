**English** · [简体中文](./README.zh-CN.md)

# pi-session-title

Two live footer chips that tell you what this session is about and what it
is doing **right now**:

```
◆ refactor login module · Last 3: switch to docker compose deploy
```

- **`◆ session topic`** — derived from the first user message; rename with
  `/topic <name>`; restored when resuming an old session
- **`Last 3:` rolling summary** — after each turn, a cheap model summarizes
  the last 3 Q&A rounds into one topic phrase; follows topic drift; falls
  back to a heuristic (last user message) when no model is reachable

Both render through `ctx.ui.setStatus()`, so they coexist with **any**
custom footer (pi-cc-extensions, the built-in footer, …). With
pi-cc-extensions, put them on a dedicated line:

```jsonc
// ~/.pi/agent/pi-cc-extensions.json
{ "footerLine3Keys": ["session-topic", "recent-topic"] }
```

## Design rule: never touches the session name

Pi writes the session name into the terminal tab title on startup, reload,
and session switches. This extension therefore keeps the topic in memory
only and never persists it as the session name — the tab title stays at
pi's default. (It does clear stale names once written by a very old
version of itself.)

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `PI_TOPIC_SUMMARY_MODELS` | `zai-coding-cn/glm-5.3-flash,zai-coding-cn/glm-5.3-highspeed` | comma-separated `provider/id` candidates for the summary call, cheapest first; falls back to the active session model |

The summary call uses no prompt caching and a fresh session id, so it never
pollutes your conversation cache.

## Commands

```
/topic          show the current topic
/topic <name>   set the topic manually
```

## Install

```bash
pi install git:github.com/codelllc09/pi-session-title
```

## License

0BSD — do whatever you want, no attribution required.
