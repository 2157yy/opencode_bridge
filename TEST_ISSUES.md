# opencode_bridge 当前遗留问题清单

> 本文档只保留 **按最近两轮人工回归（2026-04-17 / 2026-04-18）确认仍然存在** 的问题。
> 已修复、已验证通过、或属于预期行为/测试输入错误的条目已移除。

## 1. `stop` 只等待 runtime inactive，没有等待 backend 监听真正退出

- 现象：`stop --project /Users/ljp/clock` 返回成功，且 `runtime.active: false`，但随后执行：
  ```bash
  lsof -nP -iTCP:4096 -sTCP:LISTEN
  ```
  仍能看到 `.opencode` 继续监听 `127.0.0.1:4096`
- 最近复现：
  - 2026-04-17：`stop` 后仍需手工 `kill`
  - 2026-04-18：clean regression 后再次复现，残留 PID 为 `75239`
- 影响：下一轮测试前必须手工清理残留 PID，否则会干扰新的 `start`
- 当前结论：
  - `shutdown()` 路径会调用 `this.backend?.close()`
  - 但 `stop()` 只是向 owner 进程发送 `SIGTERM`，随后轮询 state 文件里的 `runtime.active`
  - 它没有验证 backend 监听端口是否真正释放
  - 因此这是 **“stop 完成条件过弱”** 的问题，而不应简单表述为“缺少一行 backend.close()”

## 2. 历史 `primary` / `subagent` 记录持续累积

- 现象：每次新一轮 `start` 之后，`status` 仍保留旧的 `primary` 和 `subagent` 记录，而不是只聚焦当前 runtime
- 最近复现：
  - 2026-04-17：`counts.total` 增长到 `5`
  - 2026-04-18：clean regression 后 `counts.total` 继续增长到 `7`
- 影响：
  - `status` 输出混入历史运行痕迹，可读性下降
  - 用户难以判断哪些 agent 属于当前这轮 runtime
- 当前结论：
  - `start` 会复用并合并旧 state，而不是在新 runtime 上只保留当前轮 agent
  - 历史 agent 没有被显式归档或裁剪
  - 因此这是 **“runtime 重启时 state 归档边界不清”** 的问题

## 3. `stop` 后 agent 计数不会随 runtime 一起收敛

- 现象：`stop` 成功后，`runtime.active` 会变为 `false`，但 `counts.active` 仍保留历史高值，不会同步下降
- 最近复现：
  - 2026-04-17：`runtime.active: false`，但 `counts.active` 仍显示 `5`
  - 2026-04-18：`runtime.active: false`，但 `counts.active` 仍显示 `7`
- 影响：runtime 生命周期与 agent 统计信息不一致，容易误导状态判断
- 当前结论：
  - `counts.active` 是按 agent 当前状态直接统计出来的，并不会在 runtime 关闭后自动切换口径
  - 但 `stop` 语义上又代表“当前 runtime 已结束”
  - 因此这是 **“runtime 关闭后统计口径与生命周期语义不一致”** 的问题

## 4. `spawnAgent` 存在重复注册，第一次 `queued` 写入没有实际持久化价值

- 现象：`src/bridge.ts` 的 `spawnAgent()` 里先执行一次
  ```ts
  this.registry.register({ ... status: 'queued', phase: 'queued', ... });
  ```
  随后又立刻执行第二次 `register()`，把同一条记录覆盖成 `running`
- 影响：
  - 第一次 `queued` 记录不会进入最终持久化结果
  - 这次 register 只是在内存里先拿到 `id`，再立刻被覆盖
  - 逻辑噪音较大，后续维护时容易误读为真的存在 `queued` 生命周期
- 当前结论：这段逻辑可以收敛为单次注册，但需要同步处理 `bindProcess()` 对已注册 agent 的依赖

## 5. `restartAgent` 只能复用归一化后的 llmConfig，不能恢复原始 env 语义

- 现象：`restartAgent()` 里只使用：
  ```ts
  const llmConfig = agent.llmConfig ?? agent.llm;
  ```
  然后把这份持久化后的配置重新注入启动环境
- 影响：
  - 如果首次 `spawnAgent()` 依赖的是 **未被 `resolveLlmConfig()` 归一化捕获** 的环境来源，重启时这部分默认值会丢失
  - `restart` 能保留 `apiKey / baseUrl / model` 这三个显式字段，但不能恢复更宽的原始 env 语义
- 当前结论：这不是普通 `OPENAI_API_KEY / OPENAI_BASE_URL / OPENCODE_MODEL` 丢失问题，而是 **“restart 只能复用归一化配置，不能还原启动时环境来源”** 的问题
- 根治建议：
  1. 在 `spawnAgent()` 时把**实际生效的 LLM 相关 env 快照**持久化到 `AgentRecord`（例如 `spawnEnv` / `llmEnv`）
  2. 在 `restartAgent()` 时优先使用这份持久化快照重建启动环境
  3. `resolveLlmConfig({})` 只应作为老数据兼容的 fallback，不应作为主要修复手段
