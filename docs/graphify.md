# Graphify

[Graphify](https://graphify.com) turns this repo into a knowledge graph (files, functions, tables, Edge Functions and how they connect) so Claude Code can answer "where is X" and "what touches Y" from a small subgraph instead of grepping the whole tree.

## What is in the repo

| Path | What it does |
| --- | --- |
| `.claude/skills/graphify/` | The `/graphify` skill for Claude Code (from `graphifyy` 0.9.85, `graphify install --project`). |
| `.claude/CLAUDE.md` | Tells Claude to run `graphify query` before raw searches and `graphify update .` after code changes. Kept out of the root `CLAUDE.md` on purpose. |
| `.claude/settings.json` | PreToolUse hooks that nudge Claude toward the graph. They do nothing on a machine without `graphify`, so cloud sessions and CI are unaffected. |
| `.gitignore` | `graphify-out/` is not committed. Each machine builds its own graph; a code-only build takes about two seconds and needs no API key. |

## One-time setup on your laptop

Install [uv](https://docs.astral.sh/uv/) if you don't have it, then the Graphify CLI with SQL support (so the Supabase migrations show up in the graph):

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install "graphifyy[sql]"
uv tool update-shell   # then open a new terminal
graphify --help        # check it's on PATH
```

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv tool install "graphifyy[sql]"
uv tool update-shell
```

The package is `graphifyy` (two y's); the command is `graphify`.

## Build and use the graph

From the repo root:

```bash
graphify update .            # code-only graph, no LLM, ~2s; writes graphify-out/
graphify hook install        # optional: rebuild on every commit and checkout
```

Then in Claude Code:

- `/graphify .` builds the full graph, including docs and specs. Code is parsed locally; the markdown in `docs/` is read by Claude Code subagents in your session, so it uses session tokens but no API key. Run it occasionally, not on every change.
- `graphify query "how does a form lead reach WhatsApp"` returns the relevant subgraph.
- `graphify path "ingest-form" "messages"` and `graphify explain "handler()"` for focused questions.
- Open `graphify-out/graph.html` in a browser for the visual map, and `graphify-out/GRAPH_REPORT.md` for the architecture summary.

## Upgrading

```bash
uv tool upgrade graphifyy
graphify install --project --platform claude   # refreshes .claude/skills/graphify
```

That command also writes a graphify section into the root `CLAUDE.md`; drop that hunk before committing, since `.claude/CLAUDE.md` already carries it. If it rewrites `.claude/settings.json`, keep the `command -v graphify` guard on both hook commands.

## Removing it

Delete `.claude/skills/graphify/`, `.claude/CLAUDE.md`, the hooks in `.claude/settings.json` and the `graphify-out/` line in `.gitignore`, then run `graphify hook uninstall` and `uv tool uninstall graphifyy` locally.
