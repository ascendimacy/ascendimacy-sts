# CLAUDE.md — ascendimacy-sts

STS v0.1 — harness externo do motor canônico.

## Arquitetura

3 packages npm workspaces:
- `shared/` — tipos compartilhados, contratos MCP persona, trace schema
- `persona-simulator/` — MCP server que simula persona via LLM (Sonnet 4.6 ou mock)
- `orchestrator/` — CLI `npx sts run`, spawna motor + persona-sim, loop de conversa, rubric, report

## Setup

```bash
node --version  # >= 22.0.0
npm install
export MOTOR_PATH=/home/alexa/ascendimacy-motor
export ANTHROPIC_API_KEY=sk-ant-...
npm run build
npm test
npm run smoke   # USE_MOCK_LLM=true por padrão
```

## Run real

```bash
MOTOR_PATH=~/ascendimacy-motor ANTHROPIC_API_KEY=... npx sts run --persona paula-mendes --turns 10
```

## Padrões técnicos

- TypeScript ESM NodeNext
- `tsconfig.build.json` separado (exclui tests do build tsc)
- `registerTool` + `as any` no inputSchema (MCP SDK v1.29 + zod v3 compat)
- `buildEnv()` forwarding explícito de API keys para child processes
- `USE_MOCK_LLM=true` para CI — sem LLM real em CI
- Motor spawna 3 servers: `$MOTOR_PATH/{planejador,motor-drota,motor-execucao}/dist/server.js`

## Refs

- Spec: `ascendimacy-ops/docs/specs/2026-04-23-sts-v1-architecture.md`
- Handoff: `ascendimacy-ops/docs/handoffs/2026-04-23-cc-sts-harness.md`
- Motor: github.com/ascendimacy/ascendimacy-motor
