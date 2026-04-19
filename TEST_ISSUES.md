# TEST_ISSUES.md

## 最新回归结论（2026-04-19）
- 自动化验证全部通过：`npm test` / `npm run typecheck` / `npm run lint` / `npm run build` / `npm run verify`
- 正向链路已验证：`start -> spawn -> status -> route -> restart -> stop -> shutdown -> status`
- 当前 runtime 已停止，状态已清空为无 active
- `.opencode-bridge/state.json` 已删除，`status` 已回到空状态

## 已验证通过
- 清理残留后的正向 `start`
- 正向 `spawn(smoke2)`
- `status` 能读到 active runtime 与 `smoke2`
- `route(smoke2)` 成功，进入 `produced`
- `restart(smoke2)` 成功，回到 `running`
- `stop` 成功，runtime 关闭
- `shutdown` 在已停止 runtime 下返回 `no active runtime to stop`（与 `stop` 一致）
- 收尾 `status` 确认：
  - `runtime.active = false`
  - `counts.active = 0`
- per-agent LLM override 生效：
  - `baseUrl = https://api.openai.com/v1`
  - `model = gpt-5.4-mini`
  - `OPENAI_API_KEY/OPENCODE_AGENT_API_KEY = test`

## 当前已知/历史问题（仍保留）
1. 初次 `start` 失败
   - 原因：`127.0.0.1:4096` 被外部 `.opencode serve` 进程占用
   - 结论：测试环境/残留进程问题

2. 测试命令被换行拆断
   - 影响：第一次正向 `spawn`、第一次 `route`
   - 现象：`zsh: command not found` / `Usage:`
   - 结论：测试输入问题，不是代码缺陷

3. 测试现场残留过多个 subagent
   - 原因：重复重试导致多个 `smoke` 记录
   - 结论：现场污染，非代码缺陷；已通过删除状态文件清理

4. `stop` 后曾短暂残留 server 进程
   - 现象：`lsof -nP -iTCP:4096 -sTCP:LISTEN` 显示 `PID 10345`
   - 进程：`/usr/local/lib/node_modules/opencode-ai/bin/.opencode serve --hostname=127.0.0.1 --port=4096`
   - 结论：已手动清理，当前端口为空

## 当前状态
- `runtime.active = false`
- `counts.active = 0`
- `counts.total = 0`
- 运行端口 4096 / 4097 目前均为空