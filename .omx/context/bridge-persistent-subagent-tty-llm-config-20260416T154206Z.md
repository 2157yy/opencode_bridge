# Context Snapshot: bridge-persistent-subagent-tty-llm-config

- **Task statement:** Clarify an execution-ready spec for fixing disappearing spawned subagents and extending the bridge so spawned agents persist across CLI invocations within a live start cycle, run in visible independent terminal windows, support per-agent LLM configuration, and persist that configuration.
- **Desired outcome:** A requirements artifact that can drive planning/execution without reopening ambiguity.
- **Stated solution:** Keep the backend alive across `spawn/status/route/restart` commands, add an explicit `stop` command, replace non-TTY child launching with OS-visible terminal/TTY launching, and extend spawn/registry state with per-agent `apiKey/baseUrl/model`.
- **Probable intent hypothesis:** The user wants a practical multi-agent bridge where subagents are durable, inspectable, independently configurable, and operationally controllable from CLI.
- **Known facts/evidence:** `src/opencode.ts` launches `opencode attach`; `src/bridge.ts` currently launches detached children with `stdio: 'ignore'`; `src/cli.ts` currently shuts the bridge down after short-lived commands; registry/state persistence already exists and state-machine changes are explicitly out of scope.
- **Constraints:** No changes to opencode binary behavior or attach argument contract; no multi-backend/HA work; no registry storage-format redesign; no dashboard work; no runtime LLM hot updates.
- **Unknowns/open questions:** None blocking after interview; downstream planning still needs implementation tradeoffs for cross-platform terminal launch abstraction.
- **Decision boundaries:** No automatic backend recovery after abnormal exit; `stop` must fail when no active backend exists; `apiKey` is allowed to persist in plaintext in `state.json`; OMX may choose launcher abstraction/platform branching details without re-asking.
- **Likely codebase touchpoints:** `src/cli.ts`, `src/bridge.ts`, `src/opencode.ts`, `src/registry.ts`, `test/bridge.test.ts`, `test/cli.test.ts`, `README.md`, `DELIVERY_SUMMARY.md`.
