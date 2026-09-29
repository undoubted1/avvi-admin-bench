# Notes for Claude Code

Read README.md first. It is the spec for the runner and scorer.

## OpenRouter

- API docs index: https://openrouter.ai/docs/llms.txt. Fetch the page you need from it; don't guess API fields.
- Endpoint: `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible). The key is `OPENROUTER_API_KEY` in `.env`. Never print, log or commit it.
- Send these on every benchmark request so the model comparison is fair and the data stays private:
  - `"provider": {"require_parameters": true, "data_collection": "deny"}`. The first sends each request only to providers that support tool calling; the second keeps prompts away from providers that store them.
  - `"usage": {"include": true}`, so each result records the real cost.
  - Headers `X-Title: Avvi Admin Bench` and `HTTP-Referer: https://avvi.cloud`.
- Keep `temperature` at 0 unless the model rejects it.
- If a model returns an error for `data_collection: deny`, report it and skip that model. Don't silently remove the setting.

## Ground rules

- Only network calls to openrouter.ai. No Microsoft, no Avvi.
- Write tools are never executed. Record them and stop.
- No real people, companies or domains in any file.
- Stop a run if total cost passes $40.
