# PRD: OpenCode 多 CLI 智能体桥

## 1. 背景
用户希望搭建一个“桥”，让 **主智能体** 和 **多个子智能体** 都以 **独立 CLI 进程 / 独立终端窗口** 的形式运行；人类主要直接与主 CLI 对话，也可以直接点名任意子 CLI。桥只负责路由、启动、状态汇总，不要求展示消息中转原文；监督重点是每个子智能体的 **任务状态 / 阶段 / 产物**。

## 2. 目标
1. 为主 CLI 提供唯一的人类默认入口。
2. 支持启动多个子 CLI，每个子 CLI 都是独立进程 / 终端窗口。
3. 支持人类直接对主 CLI 或任意子 CLI 下达指令。
4. 桥作为通路与编排层，负责启动、路由、状态记录、可观测性汇总。
5. 对子智能体的观察面只暴露：任务状态、阶段、产物（不强制暴露消息传递原文）。

## 3. 非目标（Non-goals）
- 不要求展示完整消息中转过程。
- 不把子智能体降级为非 CLI 组件。
- 不将系统改造成单窗口内的“隐藏多 agent UI”。
- 不在本阶段实现具体代码。

## 4. 约束与前提
- 每个智能体必须是 **独立 CLI 进程 / 独立终端窗口**。
- 主 CLI 是人类默认入口，但不是唯一入口。
- 子 CLI 可被人类直接点名。
- 需沿用 OpenCode 官方 CLI / Agent 原语。
- 官方文档已提供：`opencode serve`、`opencode attach`、`opencode run`、`opencode agent create/list`，以及 primary agents / subagents 的概念。

## 5. 建议架构
### 5.1 选型：共享桥后端 + 多个 CLI 前端
**推荐方案**：
- 启动一个桥后端（bridge coordinator），维护 agent registry、任务状态、产物索引。
- 主 CLI 与每个子 CLI 都作为独立终端进程启动，并通过桥后端注册。
- 子 CLI 的“工作过程”以状态机事件表示：`queued -> running -> blocked -> produced -> done/failed`。
- 终端窗口负责交互；桥后端负责路由、编排、审计与状态汇总。

**为什么选它**：
- 满足“每个智能体都是一个 CLI”这一硬约束。
- 可维持统一监督视图，但不暴露原始消息流。
- 更容易实现主/子 CLI 的直接点名。

### 5.2 被拒绝的备选
- **单窗口多 agent UI**：违反独立 CLI/窗口要求。
- **每个 agent 完全孤立、无桥状态层**：无法提供监督、路由和统一管理。
- **只用消息日志做监督**：与“只看状态/阶段/产物”的目标不一致。

## 6. OpenCode 角色映射
- **primary agent**：主 CLI，作为人类默认入口。
- **subagents**：多个子 CLI，执行可拆分任务。
- **bridge**：负责启动、注册、路由、状态汇总、产物索引。

## 7. 用户故事
1. 作为用户，我希望默认进入主 CLI 与系统对话。
2. 作为用户，我希望能指定某个子 CLI 直接下达任务。
3. 作为观察者，我希望看到每个子 CLI 当前状态、阶段和产物。
4. 作为操作者，我希望桥能启动 / 重连 / 关闭任意 CLI 进程。

## 8. 功能需求
### 8.1 启动与注册
- 桥可启动主 CLI。
- 桥可创建 N 个子 CLI 窗口。
- 每个 CLI 启动后向桥注册 `agent_id`、`role`、`window_id`、`session_id`。

### 8.2 路由
- 默认路由到主 CLI。
- 支持显式路由到指定子 CLI。
- 支持桥转发任务给指定子 CLI，而不要求暴露中转消息原文。

### 8.3 状态监督
- 展示每个 agent 的当前状态。
- 展示每个 agent 的任务阶段。
- 展示每个 agent 最近产物摘要。
- 支持查看子 agent 历史阶段与完成情况。

### 8.4 产物管理
- 每个 agent 的产物可附带可追踪引用。
- 桥汇总产物索引，便于主 CLI / 人类快速查看。

### 8.5 故障处理
- CLI 进程异常退出时，桥标记为 failed。
- 支持重连或重新拉起子 CLI。
- 任务未完成时应保留阶段与产物快照。

## 9. 可观测性
- agent 状态列表
- 任务阶段变更时间线
- 产物摘要
- 活跃 / 失败 / 已完成统计

## 10. 验收标准
1. 人类默认可从主 CLI 进入系统。
2. 可同时启动多个子 CLI 独立窗口。
3. 人类可直接点名任意子 CLI 下达任务。
4. 桥可显示每个子 CLI 的状态 / 阶段 / 产物。
5. 桥无需暴露完整消息中转即可完成监督。
6. 任一 CLI 异常退出后，状态可被正确标记。

## 11. 里程碑（未来实现建议）
1. 定义 bridge contract 和 agent registry。
2. 实现 CLI 启动器与注册机制。
3. 实现状态机与产物索引。
4. 实现路由 / 重连 / 故障恢复。
5. 加入端到端验证与文档。

## 12. 风险与缓解
- **风险：** 多 CLI 协作导致状态分裂。  
  **缓解：** 统一 registry + 状态机。
- **风险：** 终端窗口过多导致操作复杂。  
  **缓解：** 主 CLI 提供汇总视图与快捷跳转。
- **风险：** 过度依赖消息日志。  
  **缓解：** 把监督主轴固定为状态 / 阶段 / 产物。

## 13. 验证方式
- 启动验证：主 CLI + N 个子 CLI 是否可独立运行。
- 路由验证：是否能直达指定 agent。
- 状态验证：状态机是否覆盖 queued/running/blocked/produced/done/failed。
- 恢复验证：异常退出后是否能重连或重新拉起。

## 14. RALPLAN-DR 摘要
### Principles
1. 满足“每个智能体都是独立 CLI”硬约束。
2. 桥只负责路由与监督，不承担 UI 叙事。
3. 监督面应最小化，只看状态 / 阶段 / 产物。
4. 与 OpenCode 原生 primary/subagent 概念对齐。

### Decision Drivers
1. 独立 CLI / 独立终端窗口是不可妥协约束。
2. 需要主入口 + 可直接点名的子入口。
3. 需要可视监督，但不需要消息原文透明。

### Viable Options
**Option A — 共享桥后端 + 多 CLI 前端（推荐）**
- Pros: 满足约束，统一状态，易监督。
- Cons: 需要桥后端作为单点协调。

**Option B — 每个 agent 独立 backend + 独立 CLI**
- Pros: 隔离更强。
- Cons: 编排复杂、监督分散、状态难汇总。

**Option C — 单窗口多 agent UI**
- Pros: 视觉集中。
- Cons: 违反独立 CLI / 窗口要求，直接淘汰。

## 15. ADR
**Decision:** 采用“共享桥后端 + 多个 CLI 前端”的桥架构。  
**Drivers:** 独立 CLI 约束、主入口需求、可视监督需求。  
**Alternatives considered:** 每 agent 独立 backend；单窗口多 agent UI。  
**Why chosen:** 在不牺牲独立终端的前提下，最大化统一路由与状态汇总能力。  
**Consequences:** 需要维护桥后端与 registry，但换来更好的监督与可维护性。  
**Follow-ups:** 若后续进入实现阶段，优先补 registry、状态机和终端启动器。

## 16. Available Agent Types Roster（后续执行参考）
- `planner`
- `architect`
- `critic`
- `executor`
- `debugger`
- `verifier`
- `explore`
- `writer`
- `test-engineer`
- `code-reviewer`
- `security-reviewer`

## 17. 后续执行建议（若进入 ralph/team）
### Ralph
- 推荐：`executor` 1、`test-engineer` 1、`verifier` 1
- 建议推理层级：executor high / test-engineer medium / verifier high
- 适用场景：单线实现 + 反复验证

### Team
- 推荐：`planner` 1、`executor` 1-2、`test-engineer` 1、`verifier` 1、`code-reviewer` 1
- 建议推理层级：planner medium / executor high / test-engineer medium / verifier high / reviewer high
- 适用场景：桥、终端、状态、测试可并行拆分

## 18. Launch Hints（仅供后续执行）
- `omx team <plan-path>`
- `$team <plan-path>`
- `ralph <plan-path>`

## 19. Team Verification Path（仅供后续执行）
- Team 先证明：主/子 CLI 能拉起、能直达、能汇总状态。
- Ralph 后证明：状态机、错误恢复、产物索引和验收标准全部满足。
