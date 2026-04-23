# ascendimacy-sts

LAST-CO runtime — MVP-01a walking skeleton.

> **Status**: H0 scaffold — work in progress.

## Setup

```bash
node --version   # >= 22.0.0
npm install
cp .env.example .env   # preencher ANTHROPIC_API_KEY
npm test
```

## Roadmap

| H | Entregável | Status |
|---|---|---|
| H0 | Scaffold + smoke test | ✓ |
| H1 | MCP-LLM (provider Anthropic) | pending |
| H2 | MCP-ebrota-stub | pending |
| H3 | `engine/loader.js` | pending |
| H4 | `engine/composer.js` | pending |
| H5 | `engine/runtime.js` + `engine/trace.js` | pending |
| H6 | `engine/rubric.js` | pending |
| H7 | `src/cli.js` + e2e + README final | pending |

## Refs

- Release note: `ascendimacy-ops` `docs/releases/planned/v0.6-mvp-01a-last-co-skeleton.md`
- Issue tracker: ascendimacy-ops#44
