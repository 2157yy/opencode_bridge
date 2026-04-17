# 持久子代理 / 可见终端 / 每 Agent LLM 配置：交付审查说明

## 文档结论

本仓库当前应对齐的目标，不再是“独立 CLI 进程即可”，而是以下更严格的 bridge 契约：

- `start` 持有 runtime 生命周期
- `stop` / `shutdown` 成为唯一正常关闭入口
- `spawn/status/route/restart` 只连接既有 runtime，不再隐式创建 / 关闭 backend
- 每个子代理在用户可见的独立终端窗口中运行，并持有真实 TTY
- 每个子代理可独立声明 `apiKey` / `baseUrl` / `model`
- 持久化状态保留每 Agent LLM 配置；对外输出默认脱敏，但至少展示 `model`
- 自动化验证必须覆盖跨独立 CLI 进程的生命周期路径

对应需求与验收来源：

- `.omx/specs/deep-interview-bridge-persistent-subagent-tty-llm-config.md`
- `.omx/plans/prd-bridge-persistent-subagent-tty-llm-config.md`
- `.omx/plans/test-spec-bridge-persistent-subagent-tty-llm-config.md`

## 本轮文档对齐内容

已将 README / 交付说明从旧的“detached 进程 + 无显式 stop + 无 per-agent model 配置”描述，更新为围绕新桥契约的说明材料，重点覆盖：

1. **生命周期边界**
   - `start` 是 owner
   - `stop` 必须严格
   - 短命令不再拥有 backend 生命周期

2. **终端窗口 / TTY 约束**
   - 子代理必须在可见终端窗口中启动
   - launcher 需要支持平台分层与测试替身注入

3. **每 Agent LLM 配置**
   - `spawn` 支持 `--api-key` / `--base-url` / `--model`
   - 状态落盘与重启复用需要保留配置
   - 输出层默认脱敏，避免直接打印密钥

4. **验证阶梯**
   - unit / integration / e2e / manual-UX 四层验证保持与测试规格一致

## 代码审查关注点

按 approved plan 复核时，以下点必须成立，任何一项缺失都不应宣称交付完成：

- `src/cli.ts` 不再在 `status/spawn/route/restart` 结束时隐式 shutdown backend
- bridge 侧存在严格的“连接既有 runtime”路径，而不是 client 命令偷偷 auto-start
- launcher 不再只是无 TTY 的隐藏 detached child process
- registry / state 能持久化每 agent 的 `model`（以及必要的 `apiKey` / `baseUrl`）
- `status` 输出能区分 active vs stale/inactive runtime
- `stop` 在无活动 runtime 时严格报错
- 自动化测试确实使用独立 CLI 进程覆盖 `start -> spawn -> status -> route -> stop`

## 交付时必须出示的验证证据

建议按下列顺序出示 PASS/FAIL：

```bash
npm run typecheck
npm run lint
npm test
npm run verify
```

除此之外，还应补充：

1. 独立进程 `start`
2. 独立进程 `spawn --name researcher --model ...`
3. 独立进程 `status`
4. 独立进程 `route --agent <id> --text ...`
5. 显式 `stop`
6. macOS / Linux 可见终端窗口手工验证（至少一端）

## 本地复核快照（当前工作树）

基于当前实现状态，已执行：

- `npm run typecheck` → PASS
- `npm run lint` → PASS
- `npm test` → PASS（27/27）

这说明 approved plan 中的核心能力已经落地，包括：

1. `status/spawn/route/restart` 不再隐式 auto-start / auto-shutdown
2. `stop` / `shutdown` CLI 语义已接入，且无活动 runtime 时严格报错
3. `spawnAgent` 会把 `apiKey` / `baseUrl` / `model` 传入 launch plan 并持久化到状态文件
4. `restartAgent` 会复用持久化的 per-agent LLM 配置
5. `status` 输出已支持 `model` 展示与 `apiKey` 默认脱敏

## 报告位置

本次 team 交付的流程性报告位于：

- `.omx/reports/team-commit-hygiene/implement-the-approved-bridge.context.json`
- `.omx/reports/team-commit-hygiene/implement-the-approved-bridge.md`

运行时状态与每 agent LLM 配置会持久化到：

- `.opencode-bridge/state.json`

其中每个 agent 的配置字段位于：

- `agents[].llmConfig.apiKey`
- `agents[].llmConfig.baseUrl`
- `agents[].llmConfig.model`

## 多 agent 不同模型的实际命令示例

先启动长期 runtime：

```bash
node dist/src/cli.js start --project /path/to/project
```

然后在**另外的终端**里分别启动不同模型的子代理：

```bash
node dist/src/cli.js spawn \
  --project /path/to/project \
  --name researcher \
  --api-key sk-openai-example \
  --base-url https://api.openai.com/v1 \
  --model gpt-5.4

node dist/src/cli.js spawn \
  --project /path/to/project \
  --name reviewer \
  --api-key sk-alt-example \
  --base-url https://relay.example.com/v1 \
  --model gpt-4o

node dist/src/cli.js spawn \
  --project /path/to/project \
  --name writer \
  --api-key sk-local-example \
  --base-url https://llm-proxy.example.com/v1 \
  --model claude-sonnet-4-5
```

后续可继续在新的独立 CLI 调用中查看和路由：

```bash
node dist/src/cli.js status --project /path/to/project
node dist/src/cli.js route --project /path/to/project --agent <agent-id> --text "Continue the assigned task"
node dist/src/cli.js restart --project /path/to/project --agent <agent-id>
node dist/src/cli.js stop --project /path/to/project
```

说明：

- 每个 `spawn` 都可以使用不同的 `apiKey` / `baseUrl` / `model`
- 这些配置会写入 `.opencode-bridge/state.json`
- `status` 输出默认会显示 `model`，但对 `apiKey` 做脱敏
- `restart` 会复用该 agent 已持久化的 LLM 配置

## 剩余风险与提醒

- **明文持久化风险：** 本期允许 `apiKey` 明文落盘，但 CLI / status 输出仍必须默认脱敏。
- **launcher quoting 风险：** 终端应用启动命令、环境变量注入、session 参数转义都需要专门回归。
- **runtime 误恢复风险：** stale runtime 只能显式报错或显示 stale snapshot，不能偷偷 auto-recover。
- **流程性限制：** 当前工作目录不是 git 仓库；团队流程要求的提交动作可能无法本地完成，需要集成人员在真实仓库上下文补齐。

## 给集成人员的建议

合并代码、测试、文档三条工作流时，以新的 spec / PRD / test spec 为准；不要回退到旧 README 中“detached 但不可见”的语义，也不要重新引入短命令自行关闭 backend 的旧行为。
