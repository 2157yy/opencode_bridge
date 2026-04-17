# RALPLAN Draft: bridge-persistent-subagent-tty-llm-config

## RALPLAN-DR Summary

### Principles
1. Preserve the clarified lifecycle contract: `start` owns the active bridge period; short-lived commands consume it, not recreate it.
2. Meet the user-visible terminal requirement through an explicit launcher abstraction, not implicit stdio side effects.
3. Keep compatibility local: extend existing JSON snapshot/state and launch-plan seams instead of redesigning storage or state-machine layers.
4. Separate normal-path guarantees from recovery: implement strict control semantics, but do not add stale-backend auto-recovery.
5. Prove the cross-process contract with real multi-process automation, then layer platform/manual verification on top.

### Decision Drivers
1. **Lifecycle correctness:** spawned agents must remain visible/routable across separate CLI invocations within one active `start` period.
2. **Operator visibility:** each subagent must have its own OS-visible terminal window/TTY.
3. **Per-agent configurability:** `apiKey`, `baseUrl`, and `model` must be independently configurable and persisted.

### Viable Options

#### Option A — Foreground runtime owner + leased runtime metadata + window launcher abstraction **(Recommended)**
Keep `start` as the long-running owner process, but treat runtime identity as a leased service rather than a bare PID. Persist runtime metadata (`runtimeId`, owner PID, started-at, server URL, active state). Short-lived commands connect to the active bridge instead of starting their own backend. `stop` signals the owner and waits for the owner to finalize shutdown state. Launchers open OS-visible terminal windows and pass per-agent env/config.
- **Pros:** smallest change from current behavior; matches current `start` UX; gives a direct path to strict `stop`; avoids PID-only control-plane ambiguity; isolates window-launch complexity in one seam; preserves current primary-agent creation semantics.
- **Cons:** requires new runtime metadata persistence and a connect-vs-start split; cross-platform terminal launching is still nontrivial; `stop` must handle race/error reporting carefully.

#### Option B — Daemonized bridge service + command clients
Change `start` to daemonize a background bridge owner, then have all commands act as clients of that daemon via persisted state/PID.
- **Pros:** stronger explicit service model; simpler short-lived command UX after daemonization; naturally aligns with `stop`.
- **Cons:** bigger product/behavior change from today's blocking `start`; higher implementation and testing cost; more edge cases around daemon startup, logs, and reentrancy; unnecessary for current requirements.

### Why not other alternatives
- **Keep hidden detached child processes + just stop calling `shutdown`:** does not satisfy visible terminal requirement and still leaves short-lived command ownership ambiguous.
- **PTY-only inside the current process without OS window launch:** may keep `attach` alive, but fails REQ-001's visible independent terminal window contract.

### Pre-mortem (deliberate mode)
1. **Lifecycle split-brain:** short-lived commands accidentally create or close their own backend, making registry/server URL drift from the active `start` owner.
2. **Terminal launcher mismatch:** macOS/Linux launchers spawn visible windows, but argument/env quoting breaks `opencode attach` or per-agent config injection.
3. **Secret/config regression:** `apiKey/baseUrl/model` is persisted but not actually applied on restart/spawn, causing status to show one model while the terminal process uses another.

### Expanded test plan
- **Unit:** CLI command parsing, new stop semantics, launch-plan/env composition, registry persistence fields.
- **Integration:** bridge owner metadata persistence, connect-existing behavior, strict stop behavior, restart preserving per-agent config, launch abstraction invocation.
- **E2E / process-level:** real independent Node child processes for `start -> spawn -> status -> route -> stop`, using test fixtures to simulate launcher/backend safely.
- **Observability / manual:** platform checks that macOS/Linux terminal launchers open visible windows and show the executed attach command.

## Recommended Architecture / Approach

### 1) Split bridge operations into owner-only and client-of-existing flows
Introduce an explicit distinction between:
- **Owner flow (`start`)**: creates/owns backend, creates primary session if missing, persists active runtime metadata, waits for shutdown signal.
- **Client flow (`status`, `spawn`, `route`, `restart`, `stop`)**: loads persisted state, connects to the existing backend, and errors if no active owner/runtime is available.

This likely means adding a new bridge method such as `connect()` / `connectExisting()` or a `start({ requireExisting: true })` variant, but the preferred plan is a dedicated connect path to avoid overloading owner semantics.

### 2) Persist runtime-owner metadata alongside existing snapshot data
Extend the top-level persisted snapshot with a canonical runtime block sufficient for strict `stop`, stale/inactive inspection, and safe client reuse:
- `runtime.active`
- `runtime.runtimeId`
- `runtime.ownerPid`
- `runtime.startedAt`
- `runtime.serverUrl`
- optional `runtime.stopRequestedAt`
- optional `runtime.ownerCommand` / `runtime.kind` for debugging

Keep any legacy top-level `serverUrl` as a compatibility mirror or derived field, but treat `runtime.serverUrl` as the control-plane source of truth. This is an additive schema extension, not a storage-backend redesign.

### 3) Add explicit `stop` command that targets the active owner process
`stop` should:
- load the active snapshot/state
- verify that runtime metadata indicates an active owner
- fail if no active owner metadata is present
- send `SIGTERM` to the owner PID (or platform equivalent if needed)
- wait briefly for owner exit / backend unavailability
- never create a replacement backend
- leave final inactive-state persistence to the owner process so `stop` is not a competing state writer

The owner process's existing `waitForShutdownSignal()` path remains the normal shutdown path; `stop` simply becomes the remote trigger.

### 4) Replace hidden child launching with a launcher abstraction that opens visible terminal windows
Keep `defaultLaunchPlan()` responsible for the attach command and per-agent config payload, but move process/window execution into a richer launcher layer that can:
- open a new OS-visible terminal window
- execute the attach command inside that terminal with a TTY
- return lightweight window-launch metadata to the bridge without claiming that the terminal-wrapper PID is the agent PID

Platform strategy:
- **macOS:** `osascript` / `open -a Terminal` wrapper that executes a shell command and leaves the window open while the agent runs
- **Linux:** prefer available terminal apps (`xterm`, `gnome-terminal`, `konsole`, etc.) via ordered fallback
- **Tests:** inject a fake launcher that records the requested window launch without opening a real window

Because real `windowId` mapping is out of scope, the launcher should return best-effort metadata while allowing `windowId` to remain a placeholder or synthetic identifier. Session polling remains the primary source of agent liveness; launcher exit is only auxiliary evidence.

### 5) Carry per-agent LLM config through spawn, launch, persistence, and restart
Extend spawn inputs and agent records with additive LLM config:
- `apiKey?: string`
- `baseUrl?: string`
- `model?: string`

Recommended transport strategy:
- **Persist config in registry/state** as part of each agent record
- **Pass config to launched agents via environment variables** to avoid exposing secrets in process args unnecessarily
- **Preserve config on restart** by relaunching from the persisted agent record when explicit overrides are absent

A small config-mapping seam should isolate opencode-specific env/flag names so implementation can confirm the correct launch contract from opencode docs without touching higher-level CLI/registry logic. Because the spec permits plaintext persistence but does not require stdout disclosure, CLI/status output should use a redacted view that hides or masks `apiKey` while preserving `model` and `baseUrl`.

### 6) Surface model data in status output and keep route logic config-aware
At minimum, the serialized `status` snapshot should include each agent's configured `model`. Route does not need dynamic model switching, but it should resolve agents against records that carry their persisted config so future routing decisions have access to it. Under the strict no-auto-recovery contract, `status` should still be allowed to display the last persisted snapshot when runtime is inactive, but it must clearly mark the runtime as inactive/stale; `spawn`, `route`, `restart`, and `stop` must fail in that state.

## ADR

### Decision
Adopt **Option A**: keep `start` as the foreground bridge owner, add additive runtime-owner metadata plus an explicit `stop` command, connect short-lived commands only to an active owner, launch subagents in OS-visible terminal windows via a platform launcher abstraction, and persist/apply per-agent LLM config through registry and launch-plan env injection.

### Drivers
- Preserve the existing long-running `start` UX and current repo shape.
- Satisfy the new strict control semantics and visible-terminal requirement with minimal architectural churn.
- Keep the implementation grounded in existing seams (`cli.ts`, `bridge.ts`, `opencode.ts`, `registry.ts`) rather than introducing a new service layer.

### Alternatives considered
- **Daemonized bridge service**: viable but overly invasive for current scope.
- **Hidden PTY / background process only**: invalid because it fails the visible-window requirement.
- **No owner metadata / implicit backend recreation**: invalid because it breaks strict `stop` and the no-auto-recovery boundary.

### Why chosen
This path satisfies every clarified requirement while preserving the repo's current supervision model and minimizing product-shape changes.

### Consequences
- CLI semantics become stricter: non-`start` commands now depend on an existing active runtime.
- State snapshot schema grows with additive runtime + per-agent config metadata.
- Launching agents becomes platform-sensitive and needs both injected-test and real-platform coverage.

### Follow-ups
- Confirm opencode-supported env/flag names for `apiKey/baseUrl/model` during implementation.
- Decide fallback order and error messaging for Linux terminal-app discovery.
- Later iteration: real `windowId` mapping and richer terminal/window lifecycle observability.

## Implementation Plan

### Phase 1 — Runtime ownership and CLI contract
**Goal:** make `start` the explicit owner lifecycle and make `stop` the explicit terminator.
- `src/cli.ts`
  - Add `stop`/`shutdown` command.
  - Change `status` / `spawn` / `route` / `restart` to connect to an existing active runtime instead of auto-owning the backend.
  - Parse new spawn flags: `--api-key`, `--base-url`, `--model`.
- `src/bridge.ts`
  - Add runtime ownership metadata management.
  - Add `connectExisting()` (or equivalent) separate from owner `start()`, and forbid it from calling `backendFactory()`.
  - Add `stop()` / `shutdownActiveOwner()` flow for strict remote stop.
  - Ensure owner process persists active metadata on start and clears it on shutdown.
  - Make `status()` capable of returning the persisted inactive snapshot without reconnecting.

### Phase 2 — Windowed launcher + launch-plan config plumbing
**Goal:** ensure spawned agents run in visible TTY-backed windows with per-agent config.
- `src/opencode.ts`
  - Extend `LaunchOptions` / `LaunchPlan` to carry LLM config and launcher-facing execution payload.
  - Introduce config-mapping seam for env injection.
- `src/bridge.ts`
  - Extend `SpawnAgentOptions` with LLM config.
  - Persist config on agent registration / restart.
  - Upgrade launcher interface to return enough metadata for placeholder window tracking without conflating terminal-wrapper PID with agent liveness.
- new or expanded launcher module (either `src/opencode.ts` or dedicated `src/launcher.ts`)
  - Platform-specific macOS/Linux command generation
  - Test-double-friendly interface
  - Strong preference: dedicated `src/launcher.ts` so command construction and OS-window launching stay separate

### Phase 3 — Registry/status serialization
**Goal:** make per-agent config durable and inspectable.
- `src/registry.ts`
  - Add additive LLM config fields to `AgentRecord`.
  - Preserve them across register/update/restart flows.
  - Keep `model` visible in snapshot output.
  - Add runtime snapshot metadata and, if needed, launcher/window receipt fields distinct from session-backed lifecycle data.
- any exported types (`src/index.ts`)
  - Re-export updated types so programmatic consumers stay aligned.

### Phase 4 — Verification and docs
**Goal:** lock the new lifecycle contract with automation and document new operator behavior.
- `test/cli.test.ts`
  - command parsing, no implicit shutdown on short-lived commands, strict stop semantics, and redacted output semantics
- `test/bridge.test.ts`
  - connect-existing flow, persisted runtime metadata, LLM config persistence, restart preserving config, launcher invocation, and proof that `connectExisting()` never starts a new backend
- `tests/` process-level harness
  - real independent child-process flow for `start -> spawn -> status -> route -> stop`
- `README.md` / `DELIVERY_SUMMARY.md`
  - update CLI lifecycle, stop usage, terminal-window contract, and config flags
- `.omx/plans/` artifacts
  - new PRD/test spec replacing the old narrower bridge contract

## Verification Strategy / Acceptance Criteria Mapping
- **AC 1-4 (persistent visibility / route / explicit lifecycle):** process-level E2E harness with separate child processes; integration asserts runtime metadata and active-owner contract.
- **AC 5-7 (LLM config transport/persistence/status):** unit + integration tests around spawn parsing, launch env generation, persisted snapshot shape, restart reuse, and redacted CLI/status output.
- **AC 8 (automation is mandatory):** process-level tests live in `tests/` and run under `npm test`/`npm verify`.
- **AC 9-10 (explicit stop + strict error):** CLI/integration tests for teardown success and no-active-owner failure path.
- **Visible window behavior:** manual/UX verification on supported platforms plus injection-based integration assertions that the launcher selected a windowed strategy.
- **Control-plane guardrail:** integration test that inactive/stale runtime never triggers backend re-creation from client commands.

## Available-Agent-Types Roster / Staffing Guidance

### Available agent types for execution
- `executor` — primary implementation lane
- `architect` — launcher/runtime boundary review and cross-platform tradeoffs
- `test-engineer` — process-level harness, regression coverage, acceptance mapping
- `security-reviewer` — plaintext API-key persistence review / blast-radius note
- `writer` — README / delivery-summary / operator docs updates
- `verifier` — final evidence pass after implementation

### Suggested staffing for `$ralph`
Use a single `executor` owner with **high** reasoning, and pull in:
- `architect` (**high**) for an early checkpoint on lifecycle/launcher seams
- `test-engineer` (**medium**) once the runtime contract is coded
- `verifier` (**high**) at the end for acceptance cross-walk

### Suggested staffing for `$team`
Recommended lanes:
1. **Runtime/CLI lane** — `executor`, reasoning **high**
   - `src/cli.ts`, runtime owner/connect/stop flow in `src/bridge.ts`
2. **Launcher/config lane** — `executor` or `architect` + `executor`, reasoning **high**
   - `src/opencode.ts`, launcher abstraction, env/config mapping
3. **Registry/tests lane** — `test-engineer`, reasoning **medium**
   - `src/registry.ts`, snapshot/type updates, `test/*.ts`, `tests/*`
4. **Docs/verification lane** — `writer` + `verifier`, reasoning **medium/high**
   - README, DELIVERY_SUMMARY, final acceptance evidence

### Launch hints
- Sequential lane: `$ralph .omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md`
- Team lane: `$team .omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md`
- OMX CLI hint: `omx team start <name> --task-file .omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md`

### Team verification path
1. Runtime lane lands owner/connect/stop contract.
2. Launcher/config lane lands visible-window launch plan + per-agent config plumbing.
3. Test lane proves process-level lifecycle path and config persistence.
4. Docs lane updates operator contract.
5. `verifier` checks acceptance criteria against tests + manual window-launch notes.

## Architect / Critic Resolutions
1. **Control plane:** use runtime lease metadata (`runtimeId` + owner PID), not PID alone.
2. **Inactive runtime semantics:** allow `status` to inspect the last persisted snapshot, but clearly mark the runtime inactive/stale; all mutating/non-owner commands fail.
3. **Abstraction boundary:** prefer a dedicated launcher module so `opencode.ts` stays focused on attach command/config assembly.
4. **LLM config disclosure:** persist plaintext internally per spec, but redact `apiKey` from CLI/status output.
5. **Open implementation question:** confirm the exact env/flag mapping for `apiKey/baseUrl/model` supported by `opencode attach`.
