# Team Commit Hygiene Finalization Guide

- team: implement-the-opencode-multi-c
- generated_at: 2026-04-16T16:01:27.515Z
- lore_commit_protocol_required: true
- runtime_commits_are_scaffolding: true

## Suggested Leader Finalization Prompt

```text
Team "implement-the-opencode-multi-c" is ready for commit finalization. Treat runtime-originated commits (auto-checkpoints, merge/cherry-picks, cross-rebases, shutdown checkpoints) as temporary scaffolding rather than final history. Do not reuse operational commit subjects verbatim. Completed task subjects: Implement: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode- | Test: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-agent | Review and document: Implement the OpenCode multi-CLI bridge from .omx/plans/prd | Additional work (1): Implement the OpenCode multi-CLI bridge from .omx/plans/prd | Additional work (2): Implement the OpenCode multi-CLI bridge from .omx/plans/prd. Rewrite or squash the operational history into clean Lore-format final commit(s) with intent-first subjects and relevant trailers. Use task subjects/results and shutdown diff reports to choose semantic commit boundaries and rationale.
```

## Task Summary

- task-1 | status=completed | owner=worker-1 | subject=Implement: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-
  - description: Implement the core functionality for: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-agent-bridge.md and .omx/plans/test-spec-opencode-agent-bridge.md
- task-2 | status=completed | owner=worker-2 | subject=Test: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-agent
  - description: Write tests and verify: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-agent-bridge.md and .omx/plans/test-spec-opencode-agent-bridge.md
- task-3 | status=completed | owner=worker-1 | subject=Review and document: Implement the OpenCode multi-CLI bridge from .omx/plans/prd
  - description: Review code quality and update documentation for: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-agent-bridge.md and .omx/plans/test-spec-opencode-agent-bridge.md
- task-4 | status=completed | owner=worker-2 | subject=Additional work (1): Implement the OpenCode multi-CLI bridge from .omx/plans/prd
  - description: Continue implementation work on: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-agent-bridge.md and .omx/plans/test-spec-opencode-agent-bridge.md
- task-5 | status=completed | owner=worker-4 | subject=Additional work (2): Implement the OpenCode multi-CLI bridge from .omx/plans/prd
  - description: Continue implementation work on: Implement the OpenCode multi-CLI bridge from .omx/plans/prd-opencode-agent-bridge.md and .omx/plans/test-spec-opencode-agent-bridge.md

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
