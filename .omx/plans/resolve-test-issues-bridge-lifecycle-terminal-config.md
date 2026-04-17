# Resolve `TEST_ISSUES.md` end-to-end

## RALPLAN-DR Summary

### Principles
1. `start` owns the active runtime; short-lived commands only reuse it.
2. Runtime lifecycle fields are authoritative on write; do not let merge-by-default resurrect stale runtime state.
3. No auto-recovery: stale/inactive runtimes must fail explicitly.
4. Item 1 from `TEST_ISSUES.md` is a regression check only; keep it verified, but do not treat it as an implementation target.
5. Each spawned worker must be OS-visible and run the real CLI in a real terminal/TTY.
6. Per-worker LLM config must persist durably and render safely in CLI output.
7. Cross-process behavior must be proven with independent CLI processes, not in-process calls.

### Top Decision Drivers
1. Fix the remaining lifecycle issues in `TEST_ISSUES.md`; treat the previously fixed route/persistence bug as a regression guard.
2. Add explicit `stop` and eliminate implicit backend ownership from client commands.
3. Make workers visible/full-featured across macOS Terminal.app, Linux GUI terminals, and tmux.
4. Keep launcher behavior injectable so CI can fake it while manual smoke verifies real windows.

### Viable Options

#### Option A — Runtime lease + launcher abstraction + persisted worker config **(recommended)**
Keep one active bridge owner, add strict connect-only client commands, and launch workers via a platform launcher layer that opens visible terminals and runs `opencode attach` with per-worker env/config.
- Pros: minimal churn, matches clarified contract, isolates OS-specific terminal logic, keeps current registry model mostly intact.
- Cons: needs careful split between owner/client flows and a new launcher surface.

#### Option B — Daemonize the bridge and make all commands daemon clients
- Pros: explicit service model, simpler client semantics.
- Cons: bigger behavioral shift, more invasive, unnecessary for this scope.

#### Option C — Keep detached child processes and patch persistence only
- Pros: smallest code change.
- Cons: fails visible-terminal/full-CLI requirements and does not fully address the bug class.

## Recommended Architecture / Approach

1. **Owner/client split**
   - `start` creates and owns the runtime.
   - `status/spawn/route/restart/stop` connect only to an existing active runtime.
   - `stop` is the only supported teardown path and must fail when no active runtime exists.

2. **Registry as source of truth (with authoritative runtime writes)**
   - Persist runtime lease metadata (`runtimeId`, `ownerPid`, `startedAt`, `serverUrl`, `active`, stale markers).
   - Treat runtime fields as authoritative on write; avoid merge-by-default for runtime lifecycle keys so stale state cannot survive by accident.
   - Persist per-agent LLM config on each `AgentRecord`.
   - Recompute counts from registry state so `active/failed/completed` stay consistent.

3. **Visible worker launcher with explicit result contract**
   - Add a dedicated `src/launcher.ts` module (not an inline bridge helper).
   - Adapters:
     - tmux (preferred when available)
     - macOS Terminal.app via `osascript`
     - Linux terminals in this order: `xterm`, `gnome-terminal`, `konsole`
   - If no supported terminal is available, fail with a clear unsupported-platform error instead of silently falling back to hidden stdio.
   - Launcher opens a new visible terminal/window and runs the real `opencode attach` command inside it with the same CLI/tooling/hook environment a human would expect.
   - Return a structured launch receipt / failure result so the bridge can mark launch failures explicitly instead of assuming success.
   - Never treat wrapper PID as agent identity.

4. **Config transport + masking**
   - `spawn --api-key/--base-url/--model` persists values on the worker record.
   - Define explicit precedence for launch config: CLI spawn override > worker record > process env defaults.
   - Pass config into the launched worker via env (and/or terminal wrapper shell env).
   - CLI output masks `apiKey` but still shows `model` (and other non-secret fields as needed).

5. **No auto-recovery**
   - If runtime is inactive/stale, `status` may show the last snapshot, but mutating commands must refuse to recreate backend state.
   - `route`/`restart` should never implicitly start a replacement backend.

## Phased Implementation Plan

### Phase 1 — Tighten runtime ownership and stop semantics
**Touchpoints:** `src/cli.ts`, `src/bridge.ts`, `src/registry.ts`, `src/state-machine.ts`, `test/cli.test.ts`, `test/bridge.test.ts`
- Make `connectExisting()` the only path for short-lived commands.
- Keep `start` as the sole owner entrypoint.
- Add/strengthen `stop` so it signals the owner, releases the runtime, and errors when no runtime is active.
- Reconcile duplicate-primary behavior on repeated `start` so a second start does not create an extra active primary.
- Make runtime/count state consistent after shutdown.
- Add an explicit failure state path for launch/session creation failures so partial worker starts are not mistaken for success.

### Phase 2 — Add launcher abstraction for visible terminals
**Touchpoints:** `src/opencode.ts`, new `src/launcher.ts`, `src/bridge.ts`, `test/bridge.test.ts`
- Split command construction from terminal launching.
- Add platform adapters with the explicit order above.
- Launch real `opencode attach` sessions in visible terminals with full CLI/tooling/hook inheritance so workers behave like complete CLI sessions, not hidden child processes.
- Keep session identity tied to OpenCode session state, not terminal-wrapper PID.
- Make adapter results explicit (success/failure + receipt) so the bridge can finalize state correctly.

### Phase 3 — Persist and redact per-worker LLM config
**Touchpoints:** `src/registry.ts`, `src/cli.ts`, `src/opencode.ts`, `test/cli.test.ts`, `test/runtime-contract.test.ts`
- Persist `apiKey/baseUrl/model` on the worker record.
- Reuse persisted config on `restart`.
- Mask `apiKey` in all CLI-facing JSON output while leaving registry persistence plaintext as required.
- Ensure `status` surfaces enough config to inspect the worker (`model` at minimum).
- Encode config precedence in one place so ambient env cannot silently override persisted worker config.

### Phase 4 — Prove the contract with real multi-process tests
**Touchpoints:** `tests/*.cjs` or a new process harness, `test/*`, `SMOKE_TEST.md`, `README.md`
- Add forked CLI-process coverage for `start -> spawn -> status -> route -> restart -> stop`.
- Verify cross-process visibility after fresh invocations.
- Verify `route --agent <id>` works after a separate CLI process reads the same active runtime.
- Assert backend port cleanup after `stop` and strict failure for stale/inactive runtime client commands.
- Add explicit assertions that client commands do not auto-start a backend.
- Update operator docs and smoke steps to match the new lifecycle.

## Test Plan

### Unit
- CLI parsing for `stop`, `--api-key`, `--base-url`, `--model`
- launch-plan/env construction
- `apiKey` masking
- registry persistence of runtime + per-worker config

### Integration
- `start` writes runtime lease metadata
- `connectExisting()` reuses active runtime and never calls backend creation
- `stop` is strict when runtime is absent and frees the expected port
- repeated `start` does not duplicate primary agents
- `restart` reuses persisted worker config
- inactive/stale runtime is visible but non-recovering
- launch failures produce explicit failure state instead of silent partial success
- env precedence is asserted explicitly so worker config does not drift

### Real independent CLI process coverage
- Spawn separate Node CLI processes for each step:
  1. process A: `start`
  2. process B: `spawn`
  3. process C: `status`
  4. process D: `route --agent <id>`
  5. process E: `restart --agent <id>`
  6. process F: `stop`
- Use a shared temp project/state path and assert persistence across process boundaries.
- Verify the observed bug class directly: `route` must not lose the freshly spawned agent.

### Manual / platform verification
- macOS Terminal.app opens a visible window for spawned workers; pass if the window appears and runs `opencode attach`, fail if it falls back to hidden stdio.
- Linux GUI terminal opens a visible window for spawned workers using the first available adapter in the ordered fallback list; fail if no supported terminal is found or if the attach command is not visible.
- tmux remains available where configured; pass if it creates an interactive attach session with the expected env/config.

## Risks and Mitigations
- **Launcher quoting/env bugs** → adapter tests plus one real platform smoke per terminal family.
- **Stop/race double-writes** → owner-only finalization and strict runtime lease checks.
- **Plaintext `apiKey` leakage in output** → central redaction helper and snapshot tests.
- **Duplicate primaries / count drift** → idempotent start reconciliation and count recomputation from registry.
- **GUI-terminal test fragility** → keep launcher injectable so CI uses fakes; reserve GUI visibility for manual verification.

## File Touchpoints Summary
- `src/cli.ts`
- `src/bridge.ts`
- `src/opencode.ts`
- new `src/launcher.ts` (recommended)
- `src/registry.ts`
- `src/state-machine.ts` (if count/transition semantics need adjustment)
- `test/bridge.test.ts`
- `test/cli.test.ts`
- `test/runtime-contract.test.ts`
- `tests/opencode-bridge-contract.test.cjs` or a new process-level harness
- `README.md`
- `SMOKE_TEST.md`
- `DELIVERY_SUMMARY.md`

## Outcome
This plan fixes all listed `TEST_ISSUES.md` items: cross-process persistence/routing, explicit stop, no auto-recovery, visible worker terminals, full CLI workers, per-worker persisted LLM config, masked output, and macOS/Linux terminal support alongside tmux.
