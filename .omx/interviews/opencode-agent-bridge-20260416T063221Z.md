# Deep Interview Transcript — opencode-agent-bridge

## Context
Brownfield repo with `@opencode-ai/sdk` dependency and a starter `opencode.py` file. User wants an architecture/usage plan, not direct implementation.

## User goal
Build a bridge around OpenCode where:
- one main agent is the primary human entry point;
- multiple subagents are also CLIs;
- each agent runs as an independent CLI process in its own terminal window;
- humans may directly address the main CLI, and may also directly address any sub CLI;
- the bridge is only the routing/path layer;
- message transit details do not need to be visualized;
- the visible supervision surface is each subagent's work process;
- that work process should be shown as task state / phase / artifacts.

## Rounds
1. Architecture vs prototype clarified → user chose architecture/usage plan.
2. Human-to-agent topology clarified → main CLI is primary, sub CLI direct addressing allowed, bridge is routing only.
3. Work-process visibility clarified → user wants task state / phase / artifacts, not tool-call internals.
4. Terminal/process boundary clarified → each agent must be an independent CLI process / independent terminal window.

## Pressure-pass result
Earlier assumptions about needing to expose message transit and detailed intermediate steps were rejected. Visibility requirement narrowed to task state, phase, and artifacts only.

## Residual risk
No code was written. The remaining uncertainty is implementation preference for the bridge runtime and terminal orchestration details, but the architectural shape is now clear enough to plan.
