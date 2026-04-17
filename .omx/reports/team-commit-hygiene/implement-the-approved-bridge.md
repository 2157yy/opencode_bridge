# Team Commit Hygiene Finalization Guide

- team: implement-the-approved-bridge
- generated_at: 2026-04-17T00:11:24.429Z
- lore_commit_protocol_required: true
- runtime_commits_are_scaffolding: true

## Suggested Leader Finalization Prompt

```text
Team "implement-the-approved-bridge" is ready for commit finalization. Treat runtime-originated commits (auto-checkpoints, merge/cherry-picks, cross-rebases, shutdown checkpoints) as temporary scaffolding rather than final history. Do not reuse operational commit subjects verbatim. Completed task subjects: Implement: Implement the approved bridge plan from .omx/specs/deep-interview-bri | Test: Implement the approved bridge plan from .omx/specs/deep-interview-bridge-p | Review and document: Implement the approved bridge plan from .omx/specs/deep-int. Rewrite or squash the operational history into clean Lore-format final commit(s) with intent-first subjects and relevant trailers. Use task subjects/results and shutdown diff reports to choose semantic commit boundaries and rationale.
```

## Task Summary

- task-1 | status=completed | owner=worker-1 | subject=Implement: Implement the approved bridge plan from .omx/specs/deep-interview-bri
  - description: Implement the core functionality for: Implement the approved bridge plan from .omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md using .omx/plans/prd-bridge-persistent-subagent-tty-llm-config.md and .omx/plans/test-spec-bridge-persistent-subagent-tty-llm-config.md
  - result_excerpt: Implemented explicit runtime semantics and per-agent LLM config support. Changed files: src/registry.ts, src/opencode.ts, src/bridge.ts, src/cli.ts, src/index.ts, test/cli.test.ts, test/bridge.test.ts, test/runtime-contract.test.ts. Verifi…
- task-2 | status=completed | owner=worker-3 | subject=Test: Implement the approved bridge plan from .omx/specs/deep-interview-bridge-p
  - description: Write tests and verify: Implement the approved bridge plan from .omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md using .omx/plans/prd-bridge-persistent-subagent-tty-llm-config.md and .omx/plans/test-spec-bridge-persistent-subagent-tty-llm-config.md
  - result_excerpt: Verification complete. Fresh rerun against worker-1 implementation: PASS typecheck (npm run typecheck), PASS lint (npm run lint), PASS tests (npm test, 27/27). The 12 previously failing runtime-contract gaps are resolved, including strict …
- task-3 | status=completed | owner=worker-3 | subject=Review and document: Implement the approved bridge plan from .omx/specs/deep-int
  - description: Review code quality and update documentation for: Implement the approved bridge plan from .omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md using .omx/plans/prd-bridge-persistent-subagent-tty-llm-config.md and .omx/plans/test-spec-bridge-persistent-subagent-tty-llm-config.md

## Runtime Operational Ledger

- No runtime-originated commit activity recorded.

## Finalization Guidance

1. Treat `omx(team): ...` runtime commits as temporary scaffolding, not as the final PR history.
2. Reconcile checkpoint, merge/cherry-pick, cross-rebase, and shutdown checkpoint activity into semantic Lore-format final commit(s).
3. Use task outcomes, code diffs, and shutdown diff reports to name and scope the final commits.

## Recommended Next Steps

1. Inspect the current branch diff/log and identify which runtime-originated commits should be squashed or rewritten.
2. Derive semantic commit boundaries from completed task subjects, code diffs, and shutdown reports rather than from omx(team) operational commit subjects.
3. Create final commit messages in Lore format with intent-first subjects and only the trailers that add decision context.
