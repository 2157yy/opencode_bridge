# opencode_bridge Smoke Test Report

## 1. 测试目的

验证 `opencode_bridge` 在独立 CLI 调用间的基础生命周期是否正常：

- `start` 启动并保持 bridge 运行
- `status` 查看当前状态
- `spawn` 创建子代理并持久化
- `route` 向子代理下发任务
- `restart` 重启子代理
- `stop` 显式关闭 runtime

## 2. 测试环境

- 项目仓库：`/Users/ljp/opencode_bridge`
- 被测项目：`/Users/ljp/clock`
- 构建命令：`npm run build`
- CLI 入口：`node dist/src/cli.js`
- 子代理默认 LLM 配置：通过 `~/.zshrc` 中环境变量注入

## 3. 测试结论

### 结果：部分通过

核心链路 `start -> status -> spawn -> route -> restart -> stop` 已跑通。  
但测试过程中暴露了若干非阻塞问题，已记录在 `TEST_ISSUES.md`。

## 4. 执行步骤与结果

### 4.1 构建

```bash
cd /Users/ljp/opencode_bridge
npm run build
```

结果：通过。

### 4.2 启动 bridge

```bash
cd /Users/ljp/opencode_bridge
node dist/src/cli.js start --project /Users/ljp/clock
```

结果：通过，返回 runtime snapshot，runtime active。

### 4.3 查看状态

```bash
cd /Users/ljp/opencode_bridge
node dist/src/cli.js status --project /Users/ljp/clock
```

结果：通过，能看到 runtime 与 agent 列表。

### 4.4 创建子代理

```bash
cd /Users/ljp/opencode_bridge
node dist/src/cli.js spawn --project /Users/ljp/clock --name researcher
```

结果：通过，子代理成功创建，LLM 配置可见且已脱敏。

### 4.5 路由任务

```bash
cd /Users/ljp/opencode_bridge
node dist/src/cli.js route \
  --project /Users/ljp/clock \
  --agent <AGENT_ID> \
  --text "Investigate the bridge lifecycle and report issues"
```

结果：通过，agent 状态更新为 `produced`，artifact 写入成功。

### 4.6 重启子代理

```bash
cd /Users/ljp/opencode_bridge
node dist/src/cli.js restart \
  --project /Users/ljp/clock \
  --agent <AGENT_ID>
```

结果：通过，agent 重新拉起并保持同一 session。

### 4.7 关闭 runtime

```bash
cd /Users/ljp/opencode_bridge
node dist/src/cli.js stop --project /Users/ljp/clock
```

结果：通过，runtime 被显式标记为 inactive。

## 5. 观察到的问题

- 重复执行 `start` 会出现多个 `primary` agent。
- `status --project` 路径拼写错误会查到空状态，这是测试输入错误，不是 bridge 缺陷。
- 早先存在 `route` 无法跨独立 CLI 看到新 agent 的问题，已修复。
- `stop` 后仍可能看到 agent 计数为 active，说明关闭 runtime 与 agent 终态同步还需继续确认。

## 6. 附件

- `TEST_ISSUES.md`
- `SMOKE_TEST.md`

## 7. 2026-04-17 第二轮人工实战测试（项目 `/Users/ljp/clock`）

### 7.1 本轮目标

验证在不改代码的前提下，按真实人工操作顺序完成以下链路：

- 清理残留监听端口
- `start`
- 独立 CLI `status`
- `spawn`
- 独立 CLI `status`
- `route`
- 独立 CLI `status`
- `restart`
- 独立 CLI `status`
- `stop`
- 端口释放检查

### 7.2 本轮结果

结果：**核心链路通过，收尾清理发现残留监听问题仍存在。**

本轮实际验证通过了：

- `spawn` 后子代理在下一次独立 `status` 中仍可见
- `route` 能跨独立 CLI 调用命中刚创建的 agent
- `restart` 后 agent 仍保持同一 `sessionId`
- `llm` / `llmConfig` 持续可见且 `apiKey` 继续脱敏输出

### 7.3 关键实测证据

- 新 runtime：`9b611e59-952b-4001-bb8b-35140a21a70e`
- 新 primary：`ses_264098a1affebOh54XbueZCBbR`
- 新 subagent：`ses_264066154ffeWFU1PoILM7eW5v`
- `route` 成功后 agent 状态变为 `produced`
- `restart` 后子代理 PID 从 `62822` 变为 `98700`
- `stop` 后 `runtime.active` 变为 `false`
- 但 `stop` 后 `lsof -nP -iTCP:4096 -sTCP:LISTEN` 仍看到 `.opencode` 残留监听，需要手工 `kill`

### 7.4 本轮人工操作备注

- 有一次 `route` 命令进入 `dquote>`，原因是 shell 双引号未闭合；这是测试输入错误，不是 bridge 缺陷。
- `start` 后 state 中继续保留旧 `primary` / `subagent` 记录，`counts.total` 已增长到 `5`。
- `stop` 之后 `counts.active` 仍显示 `5`，未随 runtime inactive 一起收敛。

## 8. 2026-04-18 更干净的回归流程（项目 `/Users/ljp/clock`）

### 8.1 本轮目标

在清理旧 `clock` attach 进程后，重新验证一条更干净的主链路：

- `npm run build`
- `start`
- `status`
- `spawn`
- `status`
- `route`
- `restart`
- `status`
- `stop`
- `lsof` 端口检查

### 8.2 本轮结果

结果：**主链路通过，已知问题再次复现。**

确认通过：

- 新子代理 `ses_2619b88d9ffezbgZd9k04K4bvX` 在独立 `status` 中持续可见
- `route` 成功命中该子代理并写入 task artifact
- `restart` 后同一 `sessionId` 保持不变
- `stop` 后 `runtime.active` 变为 `false`

再次复现：

- `stop` 后 `lsof -nP -iTCP:4096 -sTCP:LISTEN` 仍出现 `.opencode` 残留监听（PID `75239`，已手工清理）
- `status` 中历史 `primary/subagent` 记录继续累积，`counts.total` 变为 `7`
- `stop` 后 `counts.active` 仍为 `7`

### 8.3 本轮备注

- 本轮先手工清理了 `/Users/ljp/clock` 旧 attach 进程，再重新跑回归，避免旧监听干扰。
- 这轮验证进一步确认：核心链路已通，但 runtime 收尾与历史状态归档仍需后续处理。

