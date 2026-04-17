# opencode_bridge 测试问题记录

## 2026-04-17

### 1. `route` 读不到刚 `spawn` 的 agent
- 现象：`spawn` 返回了新 agent，但下一次独立 CLI 调用 `route` 报 `unknown agent`
- 结论：后台 owner 进程会把旧内存状态重新写回磁盘，覆盖掉别的 CLI 刚写入的新 agent
- 处理：已修复为在 `persist()` 时先与磁盘 state 合并，再写回

### 2. `stop` 后 backend 监听端口可能仍占用
- 现象：`stop` 后再次 `start` 有时提示 4096 端口已被占用
- 结论：`opencode` backend 进程可能残留
- 备注：测试时需先确认 `lsof -iTCP:4096 -sTCP:LISTEN`

### 3. `start` 命令在当前 shell 会阻塞
- 现象：`start` 正常输出 snapshot 后持续运行，命令本身不会立即返回
- 结论：这是预期行为，需在独立终端继续执行 `status` / `spawn` / `route`

### 4. 重复 `start` 后可能出现多个 `primary` agent
- 现象：再次执行 `start` 后，`agents` 列表里保留了旧 primary，并新增了一个新的 primary
- 结论：当前 runtime 恢复/合并逻辑需要继续确认是否应当复用现有 primary
- 备注：测试时重点关注 `counts.total` 是否随着重复启动异常增长

### 5. `stop` 后 runtime inactive，但 agent 计数仍显示 active
- 现象：`stop --project /Users/ljp/clock` 返回 `runtime.active: false`，但 `counts.active` 仍是 `3`
- 结论：runtime 关闭与 agent 终态同步需要继续确认
- 备注：当前 smoke test 只验证显式 stop 成功，不把这个计数作为阻塞项

### 6. 缺少可对话的独立终端窗口
- 现象：测试过程中没有得到任何一个可以直接对话的终端窗口
- 问题需求：希望用 `tmux` 创建和管理窗口，让每个子代理都有可见、可交互的终端会话

### 7. 每个智能体应是完整 CLI
- 现象：当前子代理更像后台会话，不像一个可完整运行能力的 CLI
- 问题需求：每个智能体都应能读写、调用 skills、tools、MCP、hook
- 期望方式：每个 `tmux` 窗口里启动一个 `opencode` 交互命令行，类似
  ```bash
  export OMX_TEAM_WORKER_CLI=codex
  ```
  这样的 worker 运行配置
