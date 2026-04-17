# opencode_bridge Smoke Test

本文档用于验证 `opencode_bridge` 的基础生命周期：

- `start` 启动并保持 bridge 运行
- `status` 查看当前状态
- `spawn` 创建子代理
- `route` 下发任务
- `restart` 重启子代理
- `stop` / `shutdown` 结束 bridge

## 1. 前置条件

```bash
cd /Users/ljp/opencode_bridge
npm run build
```

说明：本仓库当前 smoke test 以 `node dist/src/cli.js ...` 直跑为准，不依赖全局 link。

## 2. 启动 bridge

开一个终端执行：

```bash
node dist/src/cli.js start --project /Users/ljp/opencode_bridge
```

期望：

- 输出一份 runtime snapshot
- 进程保持运行，直到显式 `stop`

## 3. 查看状态

另开一个终端：

```bash
node dist/src/cli.js status --project /Users/ljp/opencode_bridge
```

期望：

- 能看到当前 runtime
- 能看到已注册 agent（如果已有）

## 4. 创建子代理

```bash
node dist/src/cli.js spawn \
  --project /Users/ljp/opencode_bridge \
  --name researcher \
  --model gpt-4o \
  --base-url https://api.openai.com/v1 \
  --api-key <YOUR_API_KEY>
```

期望：

- 返回新 agent 的 JSON
- `apiKey` 在输出中应被脱敏
- `model` / `baseUrl` 应保留

## 5. 向子代理路由任务

把上一步返回的 `id` 填进去：

```bash
node dist/src/cli.js route \
  --project /Users/ljp/opencode_bridge \
  --agent <AGENT_ID> \
  --text "Investigate the bridge lifecycle and report issues"
```

期望：

- 任务被写入对应 session
- agent 状态保持可追踪

## 6. 重启子代理

```bash
node dist/src/cli.js restart \
  --project /Users/ljp/opencode_bridge \
  --agent <AGENT_ID>
```

期望：

- agent 保留同一个 id/session
- 进程重新拉起

## 7. 关闭 bridge

```bash
node dist/src/cli.js stop --project /Users/ljp/opencode_bridge
```

或：

```bash
node dist/src/cli.js shutdown --project /Users/ljp/opencode_bridge
```

期望：

- bridge 正常退出
- 后续 `status` 显示 runtime 不再 active

## 8. 一键 smoke test 流程

下面是一套可直接复制的最小流程：

```bash
cd /Users/ljp/opencode_bridge
npm run build

node dist/src/cli.js start --project /Users/ljp/opencode_bridge &
START_PID=$!

sleep 1
node dist/src/cli.js status --project /Users/ljp/opencode_bridge

SPAWN_OUTPUT=$(node dist/src/cli.js spawn \
  --project /Users/ljp/opencode_bridge \
  --name researcher \
  --model gpt-4o \
  --base-url https://api.openai.com/v1 \
  --api-key <YOUR_API_KEY>)
echo "$SPAWN_OUTPUT"

AGENT_ID=$(printf '%s\n' "$SPAWN_OUTPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.id || "")})')

node dist/src/cli.js route \
  --project /Users/ljp/opencode_bridge \
  --agent "$AGENT_ID" \
  --text "Investigate the bridge lifecycle and report issues"

node dist/src/cli.js restart \
  --project /Users/ljp/opencode_bridge \
  --agent "$AGENT_ID"

node dist/src/cli.js stop --project /Users/ljp/opencode_bridge
wait "$START_PID" || true
```

## 9. 自动化回归

```bash
npm run typecheck
npm run lint
npm test
npm run verify
```
