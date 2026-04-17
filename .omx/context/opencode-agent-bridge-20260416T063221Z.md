# Context Snapshot: opencode-agent-bridge

- **Task statement:** Clarify how to build an opencode-based bridge where one main agent and multiple subagents collaborate, including multiple terminal sessions, explicit main-agent conversation, message passing, and observing subagent work/process.
- **Desired outcome:** An execution-ready specification (or implementation plan) for a bridge/orchestration setup that matches the user's desired collaboration model.
- **Stated solution:** Use opencode SDK/docs as the basis for coordinating a main agent and multiple subagents, likely with multiple terminal panes or sessions.
- **Probable intent hypothesis:** The user wants a practical architecture pattern and interaction model for supervising/observing agent work, not just a conceptual summary.
- **Known facts/evidence:** Repo is a small brownfield workspace with `package.json` depending on `@opencode-ai/sdk` and an `opencode.py` file containing SDK bootstrap code.
- **Constraints:** Must avoid assuming desired scope; user wants explicit main-agent dialogue and visibility into subagent workflow. Likely wants Chinese-language guidance.
- **Unknowns/open questions:** Is the goal documentation, a code implementation in this repo, or a reusable architecture pattern? What communication topology is required between main agent and subagents?
- **Decision-boundary unknowns:** Whether the assistant may choose terminal/session topology, message transport, and supervision model without confirmation.
- **Likely codebase touchpoints:** `opencode.py`, `package.json`, possibly new orchestration scripts/config if implementation is requested.
