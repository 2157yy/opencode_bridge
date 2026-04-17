# Context Snapshot: spawn-attach-tty-session-loss

- **Task statement:** Clarify the failure mode where `start` connects the primary agent successfully, `spawn` creates a subagent record/process, but an immediate `status` no longer shows the subagent and `route` reports `unknown agent`.
- **Desired outcome:** A requirements-grade spec for the intended fix and verification target before planning/implementation.
- **Stated solution:** The current hypothesis is that `opencode attach` exits immediately without a TTY, while bridge `spawn` uses Node `spawn(...)` without allocating a pseudo-terminal.
- **Probable intent hypothesis:** The user wants the bridge to preserve subagent sessions reliably enough that spawned agents remain visible/routable across subsequent CLI invocations.
- **Known facts/evidence:** `src/opencode.ts` launches `opencode attach <serverUrl> --dir <projectDir> --session=<sessionId>`; `src/bridge.ts` default launcher uses detached `spawn(...)` with `stdio: 'ignore'`; `src/cli.ts` runs `spawn`/`status`/`route` as short-lived commands that call `bridge.shutdown()` before exit.
- **Constraints:** No new dependencies unless explicitly requested; final fix should stay small/reviewable and be verifiable with tests; brownfield TypeScript CLI project.
- **Unknowns/open questions:** Is the intended contract to support detached/non-interactive subagents across separate CLI invocations, or only while `start` keeps the backend alive? Is a PTY acceptable as the chosen mechanism, or should the bridge instead change process/session lifecycle assumptions?
- **Decision-boundary unknowns:** Whether OMX may choose PTY implementation details, attach contract changes, and backend lifecycle changes without further confirmation.
- **Likely codebase touchpoints:** `src/bridge.ts`, `src/opencode.ts`, `src/cli.ts`, `test/bridge.test.ts`, possibly CLI contract docs in `README.md` / `DELIVERY_SUMMARY.md`.
