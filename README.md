# ascendimacy-sts

STS v0.1 — harness externo do motor canônico.

Executa o `ascendimacy-motor` contra 3 personas sintéticas (Paula Mendes, Ryo, Kei) e avalia via rubric G1-G5.

## Pré-requisitos

```bash
node --version  # >= 22.0.0
# Motor buildado:
ls $MOTOR_PATH/planejador/dist/server.js  # deve existir
```

## Setup

```bash
git clone git@github.com:ascendimacy/ascendimacy-sts.git
cd ascendimacy-sts
npm install
cp .env.example .env  # preencher ANTHROPIC_API_KEY e MOTOR_PATH
npm run build
npm test
npm run smoke
```

## Run real

```bash
export MOTOR_PATH=~/ascendimacy-motor
export ANTHROPIC_API_KEY=sk-ant-...
npx sts run --persona paula-mendes --turns 10
# → traces/paula-mendes-<ts>.json
# → reports/paula-mendes-<ts>.md
# → exit 0 se G1-G4 verde
```

Personas disponíveis: `paula-mendes`, `ryo-ochiai`, `kei-ochiai`

## Rubric

| Gate | Descrição | Obrigatório |
|---|---|---|
| G1 | Completou os turns esperados | ✅ must-pass |
| G2 | Bot messages não-vazias | ✅ must-pass |
| G3 | personaEntry presente em todos turns | ✅ must-pass |
| G4 | Trace com sessionId e completedAt | ✅ must-pass |
| G5 | trustLevel não-decrescente | ⚠️ soft |

## Arquitetura

```
orchestrator/ (CLI npx sts run)
  ├── spawna motor-client → $MOTOR_PATH/{planejador,motor-drota,motor-execucao}
  ├── spawna persona-client → persona-simulator/dist/server.js
  └── loop N turns → trace → rubric → report

persona-simulator/ (MCP server)
  ├── persona_list
  ├── persona_next_message  (Sonnet 4.6 ou USE_MOCK_LLM=true)
  └── persona_reset

shared/ (tipos, contratos, trace-schema)
```

## Refs

- Spec: `ascendimacy-ops/docs/specs/2026-04-23-sts-v1-architecture.md`
- Handoff: `ascendimacy-ops/docs/handoffs/2026-04-23-cc-sts-harness.md`
- Motor: https://github.com/ascendimacy/ascendimacy-motor
- Issue: ascendimacy-ops#44
