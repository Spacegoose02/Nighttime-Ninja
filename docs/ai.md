---
title: AI helpers
nav_order: 3
---

# AI helpers

Chef Gordy, the Mixologist (Rocco), Plan my week, recipes from photos and videos, nutrition estimates and receipt scanning all use AI.
They're off until you give the server one of these:

| Option | Set | Good for |
| --- | --- | --- |
| **Claude** (recommended) | `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com) | The best answers, web search with sources, reading PDFs. You pay Anthropic per use. |
| **Your own AI server** | `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` if your server needs one | Keeping everything at home, no per-use bill. Needs a capable computer. |

If both are set, your own server is used.

## Using Claude

- `ANTHROPIC_MODEL` picks the default model (`claude-opus-5-5`). Admins can switch models in **Settings → Server admin → AI helpers**.
- Gordy and Rocco can search the web (up to 3 searches a reply, with sources listed under the answer). Admins can turn that off in the same place.
- `AI_MESSAGES_PER_HOUR` caps how many AI requests one person can send in an hour (default `30`; `0` turns it off).

## Using your own AI server

Any server with an OpenAI-compatible `/v1/chat/completions` endpoint works: [Ollama](https://ollama.com), LM Studio, llama.cpp's server, vLLM or LocalAI.

With Ollama on the same machine as Docker:

```bash
ollama pull qwen3:14b
```

```env
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_MODEL=qwen3:14b
```

On Linux, add `--add-host=host.docker.internal:host-gateway` to `docker run` (or `extra_hosts` in Compose), or use the machine's LAN address instead.

Things to know:

- Pick a model that supports **tools** and **images** if you want Gordy to save recipes and to read recipe photos and receipts. Smaller models are faster but make more mistakes with structured answers.
- There's no web search, and PDFs can't be read. Everything else works the same.
- Answers stream in as they're written, the same as with Claude.

## What it costs

**Settings → Server admin → AI helpers** shows this month's AI requests and an estimate of what they cost, by model, worked out from Claude's list prices. Your Anthropic bill is the final word. Your own server is counted at no cost.
