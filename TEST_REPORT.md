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
