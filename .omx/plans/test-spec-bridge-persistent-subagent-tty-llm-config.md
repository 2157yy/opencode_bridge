# Test Spec: 持久子代理生命周期、可见终端窗口与每 Agent LLM 配置

## 1. 测试目标
验证桥在一次有效 `start` 周期内满足：
- 活动 runtime 被短命令复用而不是重建
- 子代理跨独立 CLI 调用持续可见、可路由
- 每个子代理在可见独立终端窗口内运行
- 每 Agent LLM 配置被正确传递、持久化、重启复用
- `stop` 严格、无自动恢复、`status` 可做失活快照检查

## 2. 测试范围
### In Scope
- owner `start` / client `connectExisting` / strict `stop`
- spawn/status/route/restart 的跨进程行为
- 终端窗口启动器抽象与平台选择
- 每 Agent LLM config 持久化与输出脱敏

### Out of Scope
- 真实 OS windowId 绑定
- backend 外部异常死亡后的自动恢复
- 运行中 agent 的 LLM 配置热更新
- dashboard / 多窗口 UI

## 3. 测试分层
### Unit
1. CLI 解析 `stop`、`--api-key`、`--base-url`、`--model`
2. launch plan 生成正确的 attach 命令与环境变量
3. 输出 DTO 会脱敏 `apiKey`
4. registry 保留 runtime metadata 与 LLM config

### Integration
1. `start()` 写入 runtime lease metadata
2. `connectExisting()` 成功连接活动 runtime，且 **不会** 调用 `backendFactory()`
3. inactive runtime 下：
   - `status` 返回 stale snapshot 并带 inactive 标识
   - `spawn/route/restart/stop` 的失败路径符合契约
4. `restart` 使用持久化 LLM config 重新生成 launch plan
5. launcher receipt 与 session lifecycle 不被混淆

### E2E
1. 真实独立进程执行 `start`
2. 第二个独立进程执行 `spawn --name researcher`
3. 第三个独立进程执行 `status`，验证 researcher 仍存在
4. 第四个独立进程执行 `route --agent <id> --text ...`，验证不报 `unknown agent`
5. Teardown 调用显式 `stop`

### Manual / UX
1. macOS/Linux 上新终端窗口真实可见
2. 用户可肉眼看到窗口中执行 attach 命令
3. `status` 对 inactive/stale runtime 的标识清晰，不会误导为 live

## 4. 关键测试用例
### T1 Owner 生命周期
- **Given** 尚无活动 runtime
- **When** 执行 `start`
- **Then** 持久化 runtime metadata，bridge 进入 owner 模式

### T2 跨进程 spawn 持续可见
- **Given** 已有活动 runtime
- **When** 独立进程执行 `spawn --name researcher`
- **Then** registry 中新增子代理，后续独立 `status` 仍可见

### T3 独立终端窗口
- **Given** 执行 `spawn`
- **When** launcher 被调用
- **Then** 选择可见终端窗口策略，并执行 attach 命令

### T4 跨进程 route
- **Given** researcher 已存在
- **When** 独立进程执行 `route --agent <id> --text ...`
- **Then** 不报 `unknown agent`，并记录相应任务事件

### T5 每 Agent LLM 配置
- **Given** `spawn --api-key=a --base-url=https://x --model=gpt-4o`
- **When** agent 被注册、持久化并重启
- **Then** 配置只作用于该 agent，`model` 可见，`apiKey` 输出脱敏

### T6 Strict stop
- **Given** 活动 runtime 存在
- **When** 执行 `stop`
- **Then** owner 退出并清理 active runtime 状态

### T7 No-active stop failure
- **Given** 没有活动 runtime
- **When** 执行 `stop`
- **Then** 严格报错

### T8 No auto-recovery
- **Given** runtime inactive/stale
- **When** 执行 `spawn/route/restart`
- **Then** 失败，且不会隐式重建 backend

## 5. 验收映射
1. **AC1-4** → T1/T2/T3/T4 + E2E
2. **AC5-7** → T5 + Unit/Integration
3. **AC8** → T7
4. **AC9** → E2E 多独立进程 harness

## 6. 回归风险点
- 老的 `start().catch(status())` 或 client fallback 重新引入 auto-start
- terminal launcher quoting/env 注入错误
- `recordExit` 把 terminal wrapper 退出误记为 agent failure
- raw JSON 输出泄露 `apiKey`
- stop 与 owner 同时写 `state.json`

## 7. 验证顺序
1. 先补 unit 覆盖 CLI/launch-plan/registry/output
2. 再补 integration 覆盖 owner/connect/stop/inactive semantics
3. 最后补真实独立进程 E2E
4. 平台手工验证可见终端窗口行为
