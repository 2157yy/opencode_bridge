# OpenCode Bridge

A bridge for one long-lived OpenCode runtime plus multiple named subagents that share the same backend, remain addressable across separate CLI calls, and can carry per-agent LLM configuration.

## Approved bridge contract

The current delivery target is the persistent-subagent / visible-terminal / per-agent-LLM plan defined in:

- `.omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md`
- `.omx/plans/prd-bridge-persistent-subagent-tty-llm-config.md`
- `.omx/plans/test-spec-bridge-persistent-subagent-tty-llm-config.md`

That contract requires:

- `start` owns the active runtime until an explicit `stop` / `shutdown`
- `spawn`, `status`, `route`, and `restart` reuse the current runtime instead of auto-starting and auto-stopping their own backend
- each spawned subagent runs in its own visible terminal window / real TTY
- each subagent may override `apiKey`, `baseUrl`, and `model`
- persisted state keeps per-agent LLM configuration, while CLI-facing output shows at least the `model` and masks secrets by default
- automated verification covers the cross-process lifecycle with real independent CLI processes

## Lifecycle semantics

### `start`
- starts or resumes the bridge control plane for a project
- persists runtime metadata such as runtime identity, owner process, server URL, and active/inactive state
- keeps running until `SIGINT`, `SIGTERM`, or an explicit `stop`

### `status`
- connects to the current runtime if it is still active
- may show the last persisted snapshot when the runtime is stale or inactive
- should clearly distinguish live vs stale runtime state

### `spawn`
- creates a new named agent session under the active runtime
- launches that agent in a visible terminal window with a real TTY
- accepts per-agent LLM overrides such as `--api-key`, `--base-url`, and `--model`

### `route` / `restart`
- operate only against an already-active runtime
- must not silently create a replacement backend
- `restart` should relaunch the existing agent session with its persisted config

### `stop` / `shutdown`
- is the only supported backend teardown path for normal operation
- must fail loudly when no active runtime exists

## Per-agent LLM configuration

The approved bridge plan extends agent registration/state with per-agent LLM fields:

- `apiKey`
- `baseUrl`
- `model`

Expected behavior:

- omitted values fall back to bridge/global defaults
- persisted state keeps the full values needed for restart
- human-facing status output shows `model`
- human-facing status output masks `apiKey`

## Terminal / TTY behavior

Detached background processes are not enough for the approved contract. The launcher layer must open a user-visible terminal window for each spawned subagent so that:

- `opencode attach ... --session=<id>` runs inside a real TTY
- later `status` and `route --agent <id>` calls still target the same active session
- macOS and Linux can use different terminal-launch strategies behind the same abstraction
- tests can inject a fake launcher without depending on a real GUI terminal

## Project layout

- `src/bridge.ts` — bridge lifecycle, runtime reuse, routing, restart, persistence
- `src/cli.ts` — CLI surface for `start`, `status`, `spawn`, `route`, `restart`, and `stop`
- `src/opencode.ts` — backend/client wiring plus attach/launch planning
- `src/registry.ts` — agent registry, runtime metadata, persisted state snapshot
- `src/store.ts` — JSON persistence helpers
- `test/bridge.test.ts` — bridge/unit/integration coverage
- `test/cli.test.ts` — CLI behavior coverage
- `tests/opencode-bridge-contract.test.cjs` — contract/documentation assertions

## Target CLI examples

Build first:

```bash
npm install
npm run build
```

Then exercise the approved bridge lifecycle:

```bash
node dist/src/cli.js start --project /path/to/project
node dist/src/cli.js spawn --project /path/to/project --name researcher --model gpt-5.4-mini
node dist/src/cli.js status --project /path/to/project
node dist/src/cli.js route --project /path/to/project --agent <session-id> --text "Investigate the API regression"
node dist/src/cli.js restart --project /path/to/project --agent <session-id>
node dist/src/cli.js stop --project /path/to/project
```

Optional state path override:

```bash
node dist/src/cli.js start --project /path/to/project --state /tmp/opencode-bridge-state.json
```

## Verification targets

Use the approved verification ladder from the test spec:

1. unit coverage for CLI parsing, launch planning, masking, and persistence
2. integration coverage for owner/start vs client/connectExisting semantics
3. cross-process CLI coverage for `start -> spawn -> status -> route -> stop`
4. manual validation that spawned subagents open in visible terminal windows
5. smoke-test walkthrough in [`SMOKE_TEST.md`](./SMOKE_TEST.md)

Repo command surface:

```bash
npm run typecheck
npm run lint
npm test
npm run verify
```

## Notes for reviewers

During this plan, documentation should stay aligned to the approved persistent-runtime contract rather than the older detached-process-only bridge description. If code and docs disagree, treat the PRD/test spec above as the source of truth for the current bridge redesign.
