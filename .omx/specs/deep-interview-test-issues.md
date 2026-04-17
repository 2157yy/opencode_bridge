# Deep Interview Spec — Resolve TEST_ISSUES

## Metadata
- Profile: standard
- Context type: brownfield
- Final ambiguity: low (requirements clarified enough for planning)
- Threshold: 0.20
- Source: `TEST_ISSUES.md`
- Context snapshot: `.omx/context/test-issues-20260417T000000Z.md`

## Intent
Resolve the concrete problems recorded in `TEST_ISSUES.md`, not just rewrite the documentation.

## Desired Outcome
After the fix:
- the bridge lifecycle works reliably across independent CLI invocations;
- agents remain visible and routable after `spawn`;
- backend shutdown is explicit and clean;
- each worker can have its own visible terminal/session;
- each worker can run as a full CLI with skills/tools/MCP/hooks available;
- each worker can receive distinct LLM config values;
- LLM config is persisted in registry and shown in a sanitized way in outputs.

## In Scope
1. Fix all functional issues recorded in `TEST_ISSUES.md`.
2. Make worker sessions visible as separate terminal sessions/windows.
3. Support macOS Terminal.app and Linux GUI terminal adapters, in addition to tmux-based handling where appropriate.
4. Allow each worker to be launched with independent `apiKey`, `baseUrl`, and `model`.
5. Persist per-worker LLM config in the registry/state.
6. Store `apiKey` in registry in cleartext, but only expose it in masked form in CLI output.
7. Keep the existing registry format / state machine unless a minimal change is required to support the above.

## Out of Scope
- Reworking opencode attach contract itself.
- Real windowId-to-window mapping beyond the launcher/session abstraction needed for this fix.
- Multi-backend sharding, HA, leader election, or failover.
- Dynamic hot-update of a running worker's LLM config.
- Any broader redesign of the state machine beyond what's needed to satisfy the issues.

## Decision Boundaries
- It is acceptable to change launcher/bridge logic, CLI wiring, and registry persistence behavior.
- It is acceptable to add new launcher adapters for tmux / macOS Terminal.app / Linux terminals.
- It is acceptable to add test coverage that forks independent CLI processes to validate cross-process visibility.
- It is acceptable to keep `apiKey` in registry plaintext, but output must mask it.
- Do not change the opencode binary or its attach CLI contract.

## Constraints
- Must preserve cross-process visibility of spawned agents within the same active backend lifetime.
- Must keep independent CLI invocations working as the test harness for visibility.
- Must not rely on manual single-process testing for the cross-process persistence bug.
- Must not introduce new dependencies unless necessary.

## Testable Acceptance Criteria
- `spawn` creates a worker that remains visible to subsequent independent `status`, `route`, and `restart` calls.
- `route --agent <id>` works after a fresh CLI invocation using the same active backend.
- `stop` explicitly shuts down the backend and leaves no stray listener on the expected port.
- Worker launcher creates a visible terminal/session per agent on supported platforms.
- Worker can run as a complete CLI, not just a hidden background child process.
- `spawn --api-key ... --base-url ... --model ...` results in those values being applied to that worker.
- `status` and related commands show masked LLM config values.
- Registry/state survives backend restart and still contains historical worker config.

## Assumptions Exposed
- User wants all currently listed issues solved together, not triaged.
- User wants macOS and Linux terminal adapter support included in this pass.
- User wants plaintext registry storage for `apiKey` with masked display in CLI output.

## Pressure-pass findings
- Earlier assumption: only test-doc wording might need adjustment. Rejected after user clarified they want the actual issues solved.
- Earlier assumption: tmux-only terminal handling might be enough. Rejected after user explicitly required macOS Terminal.app and Linux GUI adapters too.
- Earlier assumption: masked-only storage for `apiKey`. Refined to plaintext storage in registry plus masked output.

## Brownfield evidence vs inference
- Evidence: `TEST_ISSUES.md` already records the route/persistence bug, stop/active-count concerns, and missing interactive terminal/CLI behavior.
- Evidence: the repository already has smoke-test artifacts and a cross-process CLI workflow.
- Inference: the launcher layer is the right place to add terminal adapter support and per-worker CLI configuration routing.

## Technical Context Findings
- The current testing model uses separate CLI invocations.
- The bug surface is split between bridge persistence, launcher behavior, and registry serialization/output masking.
- The work should likely be verified with forked independent CLI processes.

## Clarity Breakdown
| Dimension | Score | Notes |
|---|---:|---|
| Intent | 0.98 | Fix all listed issues |
| Outcome | 0.96 | Cross-process visible, routable workers + independent LLM config |
| Scope | 0.93 | Includes launcher, registry, CLI output, tests |
| Constraints | 0.90 | Explicit platform and storage constraints given |
| Success Criteria | 0.91 | Testable lifecycle + masked output + persistence |
| Context | 0.88 | Brownfield repo and existing smoke-test flow understood |

## Full issue mapping
- Issue 1: `route` must see freshly spawned agents across independent CLI calls.
- Issue 2: `stop` must cleanly stop backend and not leave port conflicts.
- Issue 3: `start` blocking behavior is expected and remains part of the lifecycle.
- Issue 4: repeated `start` should not create duplicate active primaries unless explicitly intended.
- Issue 5: after `stop`, runtime and counts should be consistent.
- Issue 6: each worker needs a visible terminal/session.
- Issue 7: each worker needs a full CLI environment with skills/tools/MCP/hooks.
- Issue 8: per-worker LLM config must be configurable and persisted.

## Handoff recommendation
Use `$ralplan` next to turn this into a PRD + test plan, then implement under that approved plan.
