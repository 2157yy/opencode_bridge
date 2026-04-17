# Deep Interview Transcript Summary: bridge-persistent-subagent-tty-llm-config

- **Profile:** standard
- **Context type:** brownfield
- **Final ambiguity:** 7.3%
- **Threshold:** 20%
- **Context snapshot:** `.omx/context/bridge-persistent-subagent-tty-llm-config-20260416T154206Z.md`

## Condensed transcript

### Round 1 — Scope / decision boundaries
- User confirmed the core fix must cover:
  1. `src/cli.ts`: stop auto-calling `bridge.shutdown()` after `spawn/status/route/restart`
  2. `src/bridge.ts`: replace non-TTY launching with PTY/equivalent so `opencode attach` stays alive
  3. preserve existing registry/persist logic, relying on the first two changes to prevent spawned agents from disappearing
- User explicitly excluded:
  - changing `opencode attach` CLI contract or opencode binary behavior
  - real `windowId` terminal mapping
  - multi-backend / HA behavior
  - registry storage format changes
  - state-machine redesign

### Round 2 — Backend failure boundary
- User rejected automatic recovery when a saved backend URL is stale.
- Supported contract: during correct use, while a `start` cycle remains valid and backend was not externally killed, spawned subagents must remain visible across independent CLI invocations.

### Round 3 — Pressure pass on success criteria
- Acceptance must include automated, real multi-process coverage.
- Manual verification is insufficient because it does not prove visibility/routability across separate CLI invocations.
- User added a required explicit `stop`/`shutdown` command for teardown instead of implicit shutdown after every command.

### Round 4 — Stop semantics + scope expansion
- `stop` must be strict: error if no active backend exists.
- User expanded scope with formal requirements:
  - REQ-001: each subagent launches in an independent OS-visible terminal window/TTY
  - REQ-002: each subagent may override `apiKey`, `baseUrl`, `model` at spawn time
  - REQ-003: these LLM settings persist in registry/state, and `status` must at least show `model`
- User excluded dashboard aggregation, window/backend lifecycle coupling, and runtime hot-updates of LLM config.

### Round 5 — Security / persistence policy
- User selected plaintext persistence for `apiKey` in `state.json` for this iteration.

## Pressure-pass finding
An earlier “bug fix” framing was insufficient. Under pressure, the user clarified that the true deliverable is a broader lifecycle contract: persistent backend ownership within a start cycle, explicit stop semantics, visible per-agent terminals, and per-agent LLM configuration/persistence. This materially changed downstream planning scope.
