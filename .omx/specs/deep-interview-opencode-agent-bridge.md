# Deep Interview Spec: opencode-agent-bridge

## Metadata
- **Profile:** standard
- **Context type:** brownfield
- **Rounds:** 4
- **Final ambiguity:** ~0.13
- **Threshold:** 0.20
- **Context snapshot:** `.omx/context/opencode-agent-bridge-20260416T063221Z.md`
- **Transcript:** `.omx/interviews/opencode-agent-bridge-20260416T063221Z.md`

## Intent
Build a bridge for OpenCode-based agent collaboration where the human primarily speaks to a main CLI, while multiple subagents each run as independent CLI processes in their own terminal windows.

## Desired outcome
A clear architecture/usage plan for:
- one main CLI for primary human interaction;
- multiple sub CLI agents;
- direct human addressing of either the main CLI or any sub CLI;
- bridge-mediated routing/path management;
- visible supervision of subagent work via task state, phase, and artifacts.

## In scope
- Bridge architecture and interaction model
- Process/terminal topology
- Human entry point rules
- Agent routing rules
- Supervision/status surface design
- OpenCode CLI/agent role mapping

## Out of scope / Non-goals
- Showing raw message transit between agents
- Exposing tool-call internals as the primary supervision UI
- Building the actual implementation in this interview mode
- Assuming a shared-session, single-window, or in-process agent model

## Decision boundaries
OMX may decide without further confirmation:
- concrete bridge architecture options for planning
- whether the bridge is described as a coordinator, launcher, or router
- how to present task-state supervision for each agent

Do not decide without user confirmation:
- replacing the independent-process / independent-window requirement
- exposing detailed message logs as the main visibility layer
- collapsing subagents into non-CLI entities

## Constraints
- User explicitly wants each agent to be a CLI process in its own terminal window.
- Human primarily talks to the main CLI.
- Subagents may also be addressed directly.
- Visibility should emphasize task status / phase / artifacts only.
- The repository is small and already contains OpenCode SDK usage hints.

## Testable acceptance criteria
A good downstream plan should be able to answer:
1. How the main CLI is launched and distinguished from sub CLIs.
2. How each subagent gets its own terminal/process.
3. How humans route directly to main or to a chosen subagent.
4. How the bridge records and displays each subagent's task state, phase, and artifacts.
5. How OpenCode's primary agents / subagents / CLI commands map onto the design.

## Assumptions exposed
- The user wants architecture first, not direct implementation.
- The bridge is a routing/orchestration layer, not a message-transparency layer.
- Subagent supervision can be satisfied by lifecycle/status artifacts rather than raw transport logs.

## Pressure-pass findings
The work-process visibility requirement was tightened from “see everything” to “see state / phase / artifacts.” That eliminated the need to surface raw tool calls or intermediate message traffic.

## Technical context findings
Official OpenCode docs describe:
- `opencode run` for non-interactive scripting
- `opencode serve` for a headless backend
- `opencode attach` to connect a terminal to a running backend
- `opencode agent create` / `list` for custom agents
- primary agents vs subagents
These are the relevant primitives for planning a CLI-per-agent bridge.

## Handoff recommendation
Use `$ralplan` next if you want a consensus architecture and test plan before implementation.
