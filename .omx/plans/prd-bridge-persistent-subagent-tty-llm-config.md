# PRD: 持久子代理生命周期、可见终端窗口与每 Agent LLM 配置

## 1. 背景
当前桥在 `spawn/status/route/restart` 等短命令中会隐式启动并关闭 backend，且子代理通过无 TTY 的隐藏子进程启动，导致：
- `spawn` 后子代理在后续独立 CLI 调用中消失
- `route` 因 registry / session 生命周期不连续而报 `unknown agent`
- 子代理没有用户可见的独立终端窗口
- 每个子代理无法独立声明和持久化自身的 LLM 配置

本次需求将其收敛为一个明确的正常路径契约：在同一次有效 `start` 周期内，桥是持续存在的控制平面，子代理跨多次独立 CLI 调用持续可见、可路由、可在独立终端窗口中观察，并支持每 Agent 独立 LLM 配置。

## 2. 目标
1. `start` 成为唯一 owner 生命周期入口；`spawn/status/route/restart` 不再隐式关闭 backend。
2. 增加显式 `stop/shutdown` 命令，并在无活动 runtime 时严格报错。
3. 每个子代理通过 OS 可见的独立终端窗口启动并持有真实 TTY。
4. 每个子代理可独立指定 `apiKey`、`baseUrl`、`model`。
5. 每 Agent LLM 配置被持久化；`status` 至少展示 `model`。
6. 核心跨进程回归由真实独立 CLI 进程自动化测试覆盖。

## 3. 非目标
- 不修改 `opencode attach` 的外部命令行契约，不修改 opencode 二进制本身。
- 不实现真实 `windowId` 与 OS 窗口 ID 的强绑定。
- 不实现多 backend 分片、高可用、故障转移。
- 不重设计现有状态机。
- 不实现运行中 agent 的 LLM 配置热更新。
- 不为 backend 被外部杀死或 URL 失效提供自动恢复。
- 不构建多窗口 dashboard；本次只保证 OS 级独立窗口可见。

## 4. 关键产品契约
### 4.1 生命周期
- `start`：启动并持有活动 runtime，直至收到显式 stop/系统信号。
- `stop`：仅在存在活动 runtime 时成功；否则严格报错。
- `spawn/route/restart`：只能连接既有活动 runtime，绝不能自行新建 backend。
- `status`：允许查看最后一次持久化快照，但若 runtime 已失效，必须明确标记为 inactive/stale。

### 4.2 可见终端窗口
- `spawn --name researcher` 后，系统必须自动打开一个新的可见终端窗口。
- 该窗口中应执行 `opencode attach ...` 并承载后续任务。
- 各子代理窗口相互独立。

### 4.3 每 Agent LLM 配置
- `spawn` 支持 `--api-key`、`--base-url`、`--model`。
- 未指定时回落到 bridge 全局默认配置。
- 配置持久化到 registry/state，供 `status`/`restart`/未来路由策略读取。
- `apiKey` 可按本期要求明文落盘，但 CLI 对外展示必须默认脱敏。

## 5. 架构决策
### 5.1 运行时控制平面
采用“前台 owner + runtime lease metadata”方案：
- `start` 作为 owner 进程
- 持久化 `runtimeId`、`ownerPid`、`startedAt`、`serverUrl`、`active`
- 客户端命令只连接既有 runtime，不拥有 backend

### 5.2 启动器分层
- `opencode.ts`：仅负责生成 attach 命令与环境配置
- `launcher.ts`：负责 macOS/Linux 的可见终端窗口启动
- session 轮询是 agent 存活的主判据；窗口/launcher 退出只作辅助证据

### 5.3 输出与持久化分离
- registry/state 内部记录完整配置
- CLI/status 输出使用脱敏视图
- `model` 必须可见；`apiKey` 默认隐藏

## 6. 功能需求
### 6.1 CLI
- 新增 `stop` / `shutdown`
- `spawn` 解析 `--api-key` / `--base-url` / `--model`
- `status` 输出 runtime 活跃态

### 6.2 Bridge
- owner `start()` 与 client `connectExisting()` 分离
- `connectExisting()` 不允许调用 `backendFactory()`
- `stop()` 只发送关闭请求并等待 owner 清理状态，避免双写

### 6.3 Registry / Snapshot
- 增加 runtime metadata
- `AgentRecord` 增加 LLM config 字段
- 必要时增加 launcher/window receipt 字段，但不得将 terminal wrapper PID 误认为 agent PID

### 6.4 Launcher
- macOS：优先 `osascript` / Terminal.app
- Linux：按可用性依次尝试常见 terminal app
- 测试环境支持 fake launcher 注入

## 7. 验收标准
1. 一次有效 `start` 后，独立进程执行 `spawn` 能创建子代理并保持可见。
2. 新开终端窗口对用户可见，且其中运行 `opencode attach`。
3. 独立进程执行 `status` 时仍能看到该子代理。
4. 独立进程执行 `route --agent <id>` 不再报 `unknown agent`。
5. `spawn --api-key --base-url --model` 仅影响目标 agent。
6. `restart` 可复用已持久化的 agent LLM 配置。
7. `status` 至少展示每个 agent 的 `model`。
8. `stop` 在无活动 runtime 时严格报错。
9. 以上核心契约必须由真实独立 CLI 进程自动化测试覆盖。

## 8. 风险与缓解
- **风险：** client 命令误走 auto-start 老路径。  
  **缓解：** `connectExisting()` 与 `start()` 物理分离，并为“不得创建 backend”写集成测试。
- **风险：** 终端 wrapper PID 与 agent 真实生命周期混淆。  
  **缓解：** 以 session 轮询为主，launcher receipt 为辅。
- **风险：** 明文持久化的 `apiKey` 被 CLI 直接打印。  
  **缓解：** 输出 DTO 脱敏，测试覆盖。
- **风险：** stop 与 owner 双写 state 造成竞态。  
  **缓解：** owner 为最终状态写入者。

## 9. 实施阶段
1. 运行时 ownership 与 CLI 契约
2. 可见窗口启动器与 LLM config 传递
3. registry/snapshot 扩展与输出脱敏
4. 多进程自动化测试与文档更新
