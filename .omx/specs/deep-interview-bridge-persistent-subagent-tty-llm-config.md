# Deep Interview Spec: bridge-persistent-subagent-tty-llm-config

## Metadata
- **Profile:** standard
- **Rounds:** 5
- **Final ambiguity:** 7.3%
- **Threshold:** 20%
- **Context type:** brownfield
- **Context snapshot:** `.omx/context/bridge-persistent-subagent-tty-llm-config-20260416T154206Z.md`
- **Transcript:** `.omx/interviews/bridge-persistent-subagent-tty-llm-config-20260416T154206Z.md`

## Clarity breakdown
| Dimension | Score |
| --- | ---: |
| Intent | 0.90 |
| Outcome | 0.94 |
| Scope | 0.92 |
| Constraints | 0.96 |
| Success Criteria | 0.94 |
| Context | 0.92 |

Readiness gates:
- **Non-goals:** explicit
- **Decision boundaries:** explicit
- **Pressure pass:** complete

## Intent
Build a practical opencode bridge where spawned subagents do not disappear across separate CLI calls during a valid `start` lifecycle, are visibly inspectable in their own terminal windows, and can be configured independently at the LLM level.

## Desired Outcome
Within one active `start` cycle:
1. `spawn` creates a subagent that remains visible to later independent `status` calls.
2. `route --agent <id>` can still address that subagent without `unknown agent`.
3. Each spawned subagent runs in its own user-visible OS terminal window/TTY.
4. Each subagent may override `apiKey`, `baseUrl`, and `model`.
5. Those LLM settings persist in registry/state output, with `status` exposing at least the `model`.
6. Backend shutdown becomes explicit via a CLI `stop`/`shutdown` command.

## In Scope
- Remove implicit backend shutdown from `spawn`, `status`, `route`, and `restart` command endings in `src/cli.ts`.
- Add explicit `stop`/`shutdown` CLI command.
- Change launcher behavior so spawned agents run with a real TTY and an OS-visible independent terminal window.
- Abstract launcher behavior sufficiently to support platform-specific terminal launch strategies.
- Extend spawn input/options with optional `apiKey`, `baseUrl`, `model`.
- Pass per-agent LLM config to the launched agent process via command args and/or environment variables.
- Persist per-agent LLM config in registry/state.
- Update `status` output to include model information.
- Add automated tests that fork real independent CLI processes to verify cross-process lifecycle behavior.

## Out of Scope / Non-goals
- Changing `opencode attach` argument contract or patching the opencode binary.
- Implementing true terminal-window identity mapping for `windowId`.
- Multi-backend sharding, election, failover, or HA.
- Changing registry storage format/backend beyond adding fields to the existing JSON state shape.
- Redesigning the state machine.
- Building a dashboard or unified live UI for all terminal windows.
- Coupling agent state to OS window lifecycle behavior.
- Hot-updating LLM config for already running agents.
- Automatic recovery when backend was externally killed or saved backend URL is stale.

## Decision Boundaries (OMX may decide without confirmation)
- Exact launcher abstraction shape and platform branching strategy.
- Whether LLM config is passed by env vars, CLI flags, or a mixed approach, so long as the attach contract remains externally compatible.
- Exact JSON field names/structuring for persisted LLM config, provided they preserve the requested semantics.
- Exact test harness structure, provided it uses real independent processes for the key lifecycle regression.

## Constraints
- Normal-path guarantee only: behavior is only promised while user uses the tool correctly and backend remains alive within the active `start` cycle.
- `stop` must be strict: if there is no active backend to stop, return an error.
- `apiKey` may be stored in plaintext in `state.json` for this iteration.
- Cross-platform terminal launch is required at the launcher abstraction level; likely examples include macOS Terminal/osascript and Linux terminal apps.
- Final diff should stay aligned with existing persistence/state patterns where possible.

## Testable Acceptance Criteria
1. Starting the bridge and keeping that start lifecycle alive, then executing `spawn --name researcher` in a separate CLI process, causes a new OS-visible terminal window to open for the subagent.
2. The user can observe that terminal window running `opencode attach` and subsequent routed work.
3. Executing `status` in another independent CLI process during the same active start lifecycle still lists `researcher` instead of losing it from the registry.
4. Executing `route --agent <researcher-id> --text ...` in another independent CLI process no longer fails with `unknown agent`.
5. `spawn --name researcher --api-key=xxx --base-url=https://... --model=gpt-4o` causes that subagent to run with those LLM settings, without affecting other agents.
6. When spawn options are omitted, the agent falls back to global/default backend configuration.
7. Persisted state includes per-agent LLM configuration; `status` output includes at least the agent model.
8. Automated tests cover the cross-process lifecycle path using real forked CLI processes; manual-only validation is insufficient.
9. Automated teardown uses explicit `stop`/`shutdown`.
10. `stop` returns an error when no active backend exists.

## Assumptions Exposed + Resolutions
- **Assumption:** This is only a TTY bug fix.
  - **Resolution:** No; it is a broader lifecycle + visibility + configuration feature set.
- **Assumption:** Auto-recovering a dead backend might be desirable.
  - **Resolution:** Rejected for this scope; require correct-use semantics only.
- **Assumption:** Manual validation could be enough.
  - **Resolution:** Rejected; cross-process behavior must be covered by automated process-level tests.
- **Assumption:** Sensitive config persistence should default to secrecy.
  - **Resolution:** Rejected for this iteration; plaintext `apiKey` persistence is accepted.

## Pressure-pass findings
The conversation started from a root-cause hypothesis about non-TTY `opencode attach`, but pressure-testing revealed the user’s real target contract includes explicit backend lifecycle control, visible per-agent terminal windows, process-level regression coverage, and durable per-agent LLM configuration. Downstream planning should treat this as a featureful lifecycle redesign, not a narrow bug patch.

## Brownfield evidence vs inference
### Evidence
- `src/opencode.ts` uses `opencode attach ... --session=...`.
- `src/bridge.ts` launches detached child processes with `stdio: 'ignore'`.
- `src/cli.ts` currently shuts the bridge down after short-lived commands.
- Registry/state persistence already exists in the repo.

### Inference
- Platform-specific terminal launch will likely need launcher abstraction changes beyond a simple stdio toggle.
- Status output and route decisions will need registry shape extensions for LLM config.

## Technical context findings
Likely touched files:
- `src/cli.ts`
- `src/bridge.ts`
- `src/opencode.ts`
- `src/registry.ts`
- `test/bridge.test.ts`
- `test/cli.test.ts`
- `README.md`
- `DELIVERY_SUMMARY.md`

## Condensed transcript
See `.omx/interviews/bridge-persistent-subagent-tty-llm-config-20260416T154206Z.md`.
