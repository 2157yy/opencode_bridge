# PRD: opencode_bridge tmux 集成

> 本文档为开发需求文档，阅读后可直接编写代码。

---

## 1. 背景与目标

### 1.1 现状

`opencode_bridge` 是一个 TypeScript/Node.js 桥接库，用于管理 opencode CLI 的多 agent 会话。当前 `launcher.ts` 仅支持：

- `tmux new-window` — 在 tmux 中创建新窗口运行 CLI
- macOS Terminal.app — 通过 osascript 启动
- Linux 终端 — xterm/gnome-terminal/konsole

**缺失能力：**
1. 无法在当前 tmux window 中 `split-window` 创建新 pane
2. 无法向已有 pane 注入文字命令并自动回车
3. 无法捕获 pane 输出以判断 CLI 是否就绪
4. 无法自动启动 CLI 并等待其完成初始化

### 1.2 目标

新增 `src/tmux.ts` 模块，并改造 `src/launcher.ts` 和 `src/bridge.ts`，实现：

1. **自动创建 tmux pane** — 在当前 tmux window 中水平/垂直分割出新 pane
2. **注入命令并回车** — 通过 `tmux send-keys` 向指定 pane 发送文字 + 回车
3. **捕获 pane 输出** — 通过 `tmux capture-pane` 读取 pane 内容
4. **自动启动 CLI** — 在新 pane 中启动 `opencode` CLI 并等待就绪
5. **pane 生命周期管理** — 创建、存活检测、销毁

### 1.3 参考实现

oh-my-codex 项目中以下文件包含完整参考实现（本文档已从中提取核心模式）：

| 文件 | 职责 |
|---|---|
| `src/team/tmux-session.ts` | 核心会话管理：runTmux、createTeamSession、spawnWorker、sendToWorker、waitForWorkerReady |
| `src/hud/tmux.ts` | pane CRUD：listPanes、createHudWatchPane、killTmuxPane、resizeTmuxPane |
| `src/notifications/tmux.ts` | 环境检测：isInsideTmux、getCurrentTmuxSession、getCurrentTmuxPaneId |
| `src/scripts/notify-hook/tmux-injection.ts` | 注入引擎：resolvePaneTarget、sendKeys 提交 |

---

## 2. 架构设计

### 2.1 新增文件

```
src/tmux.ts    — tmux 底层操作模块（全新）
```

### 2.2 修改文件

```
src/launcher.ts   — 增加 split-pane 启动模式
src/opencode.ts   — 增加 autoStartCli 函数
src/bridge.ts     — spawnAgent 中集成 tmux split-pane + 自动注入
src/index.ts      — 导出新增公共 API
src/cli.ts        — 增加 tmux 子命令（可选）
```

### 2.3 模块依赖关系

```
cli.ts
  └→ bridge.ts
       ├→ opencode.ts  (startBackend, createClient, defaultLaunchPlan, autoStartCli)
       ├→ launcher.ts  (defaultLauncher, splitPaneLauncher)
       ├→ tmux.ts      (新增：底层 tmux 操作)
       ├→ registry.ts  (不变)
       ├→ state-machine.ts (不变)
       └→ store.ts     (不变)
```

---

## 3. 详细需求：`src/tmux.ts`

### 3.0 总体原则

- 使用 `node:child_process` 的 `spawnSync` / `execFileSync` 执行 tmux 命令
- 所有 tmux 调用统一走 `runTmux()` / `runTmuxAsync()` 封装
- 不依赖 oh-my-codex 的 `platform-command.ts`（该项目无此依赖），直接调用 `tmux`
- 使用 `export` 导出所有公共函数和类型
- TypeScript strict mode，target ES2022, module NodeNext

### 3.1 类型定义

```typescript
/** tmux 命令执行结果 */
export type TmuxResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string };

/** pane 信息快照 */
export interface TmuxPaneInfo {
  paneId: string;        // 如 "%0"
  panePid: number;       // pane 中 shell 的 PID
  currentCommand: string; // 当前运行的命令
  startCommand: string;   // pane 启动命令
  sessionName: string;    // 所属 session 名
  windowIndex: number;    // 所属 window 索引
  paneWidth: number;      // pane 宽度（列数）
  paneHeight: number;     // pane 高度（行数）
}

/** split-pane 创建选项 */
export interface SplitPaneOptions {
  /** 分割方向：vertical=水平分割(上下), horizontal=垂直分割(左右) */
  direction?: 'vertical' | 'horizontal';
  /** 新 pane 高度(垂直分割时)或宽度(水平分割时)的行/列数 */
  size?: number;
  /** 新 pane 的百分比大小(如 30 表示 30%)，与 size 互斥 */
  percentage?: number;
  /** 工作目录 */
  cwd: string;
  /** 环境变量 */
  env?: NodeJS.ProcessEnv;
  /** 是否后台创建(不激活新 pane)，默认 true */
  detached?: boolean;
  /** 创建后自动执行的 shell 命令 */
  shellCommand?: string;
}

/** sendKeys 选项 */
export interface SendKeysOptions {
  /** 目标 pane（paneId 如 "%0"，或 "session:window.pane" 格式） */
  target: string;
  /** 要发送的文字 */
  text: string;
  /** 是否在文字后追加回车，默认 true */
  enter?: boolean;
  /** 发送前的延迟(ms) */
  delayBeforeMs?: number;
  /** 是否以 literal 模式发送（-l 标志），默认 true */
  literal?: boolean;
}

/** 创建 pane 的返回值 */
export interface SplitPaneResult {
  paneId: string;     // tmux pane ID，如 "%5"
  target: string;     // tmux 完整 target 格式
}
```

### 3.2 环境检测函数

#### `isTmuxAvailable(): boolean`

```typescript
/**
 * 检测 tmux 二进制是否可用。
 * 通过 spawnSync('tmux', ['-V']) 检测。
 * 结果缓存（模块级变量），只检测一次。
 */
export function isTmuxAvailable(): boolean;
```

**实现要点：**
- 使用 `spawnSync('tmux', ['-V'])` 检测
- 检测结果用模块级 `let cached: boolean | undefined` 缓存
- 检测失败（非零退出码、ENOENT）返回 false

#### `isInsideTmux(): boolean`

```typescript
/**
 * 检测当前进程是否运行在 tmux 内。
 * 检查 process.env.TMUX 是否存在且非空。
 */
export function isInsideTmux(): boolean;
```

#### `getCurrentSessionName(): string | null`

```typescript
/**
 * 获取当前 tmux session 名称。
 * 1. 如果 TMUX 环境变量存在，通过 tmux display-message -p "#S" 获取
 * 2. 失败返回 null
 */
export function getCurrentSessionName(): string | null;
```

#### `getCurrentPaneId(): string | null`

```typescript
/**
 * 获取当前 tmux pane ID（如 "%0"）。
 * 1. 先检查 process.env.TMUX_PANE（格式 /^%\d+$/）
 * 2. 否则通过 tmux display-message -p "#{pane_id}" 获取
 * 3. 失败返回 null
 */
export function getCurrentPaneId(): string | null;
```

### 3.3 底层执行函数

#### `runTmux(args: string[]): TmuxResult`

```typescript
/**
 * 同步执行 tmux 命令。
 * 
 * @param args - tmux 子命令参数数组
 * @returns 成功返回 { ok: true, stdout }，失败返回 { ok: false, stderr }
 * 
 * 实现方式：spawnSync('tmux', args, { encoding: 'utf-8' })
 * 
 * 参考实现：oh-my-codex/src/team/tmux-session.ts → runTmux()
 */
export function runTmux(args: string[]): TmuxResult;
```

**实现细节：**
```typescript
export function runTmux(args: string[]): TmuxResult {
  const result = spawnSync('tmux', args, { encoding: 'utf-8' });
  if (result.error) {
    return { ok: false, stderr: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, stderr: (result.stderr || '').trim() || `tmux exited ${result.status}` };
  }
  return { ok: true, stdout: (result.stdout || '').trim() };
}
```

#### `runTmuxAsync(args: string[]): Promise<TmuxResult>`

```typescript
/**
 * 异步执行 tmux 命令。
 * 使用 execFile('tmux', args) + promisify。
 */
export async function runTmuxAsync(args: string[]): Promise<TmuxResult>;
```

### 3.4 Session 管理

#### `listSessions(): string[]`

```typescript
/**
 * 列出所有 tmux session 名称。
 * tmux list-sessions -F '#{session_name}'
 * 失败返回空数组。
 */
export function listSessions(): string[];
```

#### `hasSession(name: string): boolean`

```typescript
/**
 * 检查指定名称的 tmux session 是否存在。
 */
export function hasSession(name: string): boolean;
```

#### `killSession(name: string): boolean`

```typescript
/**
 * 销毁指定 tmux session。
 * tmux kill-session -t <name>
 * 失败返回 false。
 */
export function killSession(name: string): boolean;
```

### 3.5 Pane 管理

#### `listPanes(target?: string): TmuxPaneInfo[]`

```typescript
/**
 * 列出 tmux pane。
 * 
 * @param target - 可选的 session/window target。不传则列出所有 pane。
 * 
 * tmux list-panes {target} -F '#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_start_command}\t#{session_name}\t#{window_index}\t#{pane_width}\t#{pane_height}'
 * 
 * 返回值按 pane_id 排序。
 * 失败返回空数组。
 */
export function listPanes(target?: string): TmuxPaneInfo[];
```

#### `createSplitPane(options: SplitPaneOptions): SplitPaneResult`

```typescript
/**
 * 在当前 tmux window 中创建新的 split pane。
 * 
 * 前置条件：isInsideTmux() === true && isTmuxAvailable() === true
 * 不满足则抛出 Error。
 * 
 * 构造 tmux 命令：
 *   tmux split-window
 *     -{direction_flag}          // -v 或 -h
 *     -l {size}                  // 或 -p {percentage}
 *     -d                         // detached（默认）
 *     -c {cwd}                   // 工作目录
 *     -P -F '#{pane_id}\t#{session_name}:#{window_index}.#{pane_index}'
 *     {shellCommand}             // 可选的启动命令
 * 
 * direction_flag:
 *   'vertical'   → '-v' (上下分割，新 pane 在下方)
 *   'horizontal' → '-h' (左右分割，新 pane 在右侧)
 * 
 * size vs percentage:
 *   - 如果 options.size 提供 → '-l {size}'
 *   - 如果 options.percentage 提供 → '-p {percentage}'
 *   - 都不提供 → 不传尺寸参数（tmux 默认平分）
 * 
 * env 处理：
 *   遍历 options.env，对每个 key=value 对，
 *   在 shellCommand 前面添加环境变量前缀。
 *   如果没有 shellCommand，则使用 sh -c 'env_prefix + sleep infinity' 保持 pane 存活。
 * 
 * 返回解析后的 { paneId, target }。
 * 
 * 参考实现：
 *   oh-my-codex/src/hud/tmux.ts → createHudWatchPane()
 *   oh-my-codex/src/team/tmux-session.ts → spawnWorker()
 */
export function createSplitPane(options: SplitPaneOptions): SplitPaneResult;
```

**完整实现伪代码：**
```typescript
export function createSplitPane(options: SplitPaneOptions): SplitPaneResult {
  if (!isInsideTmux() || !isTmuxAvailable()) {
    throw new Error('tmux is not available or not inside a tmux session');
  }

  const dirFlag = options.direction === 'horizontal' ? '-h' : '-v';
  const detached = options.detached !== false ? ['-d'] : [];
  
  // 尺寸参数
  const sizeArgs: string[] = [];
  if (options.size != null) {
    sizeArgs.push('-l', String(options.size));
  } else if (options.percentage != null) {
    sizeArgs.push('-p', String(options.percentage));
  }
  
  // 环境变量前缀
  const envPrefix = buildEnvPrefix(options.env);
  
  // shell 命令
  const command = options.shellCommand
    ? (envPrefix ? `${envPrefix} ${options.shellCommand}` : options.shellCommand)
    : undefined;

  const args = [
    'split-window',
    dirFlag,
    ...sizeArgs,
    ...detached,
    '-c', options.cwd,
    '-P', '-F', '#{pane_id}\t#{session_name}:#{window_index}.#{pane_index}',
    ...(command ? [command] : []),
  ];

  const result = runTmux(args);
  if (!result.ok) {
    throw new Error(`createSplitPane failed: ${result.stderr}`);
  }

  const [paneId, target] = result.stdout.split('\t');
  if (!paneId?.startsWith('%')) {
    throw new Error(`createSplitPane: unexpected output: ${result.stdout}`);
  }

  return { paneId, target };
}
```

#### `killPane(paneId: string): boolean`

```typescript
/**
 * 销毁指定 tmux pane。
 * 
 * @param paneId - 必须以 '%' 开头
 * tmux kill-pane -t {paneId}
 * 
 * 参考实现：oh-my-codex/src/hud/tmux.ts → killTmuxPane()
 */
export function killPane(paneId: string): boolean;
```

#### `isPaneAlive(paneId: string): boolean`

```typescript
/**
 * 检查 pane 是否存活。
 * tmux list-panes -t {paneId} -F '#{pane_dead} #{pane_pid}'
 * 
 * pane_dead=1 或 pane 不存在 → false
 * pane_dead=0 且 pane_pid 对应进程存活 → true
 * 
 * 参考实现：oh-my-codex/src/team/tmux-session.ts → isWorkerAlive()
 */
export function isPaneAlive(paneId: string): boolean;
```

#### `resizePane(paneId: string, height: number): boolean`

```typescript
/**
 * 调整 pane 高度。
 * tmux resize-pane -t {paneId} -y {height}
 */
export function resizePane(paneId: string, height: number): boolean;
```

### 3.6 输入注入

#### `sendKeys(options: SendKeysOptions): TmuxResult`

```typescript
/**
 * 向 tmux pane 发送按键/文字。
 * 
 * 流程：
 *   1. 如果 delayBeforeMs > 0，await delay(delayBeforeMs)
 *   2. tmux send-keys -t {target} -l -- {text}    // literal 模式
 *      或 tmux send-keys -t {target} -- {text}     // 非 literal
 *   3. 如果 enter !== false：
 *      tmux send-keys -t {target} C-m              // 发送回车
 * 
 * 注意：-l 标志让 tmux 逐字发送，避免特殊字符被解释为按键名。
 *       C-m 是回车键的 tmux 表示。
 * 
 * 参考实现：
 *   oh-my-codex/src/team/tmux-session.ts → sendLiteralTextOrThrow() + C-m
 *   oh-my-codex/src/scripts/notify-hook/tmux-injection.ts → buildSendKeysArgv()
 */
export function sendKeys(options: SendKeysOptions): TmuxResult;
```

**实现伪代码：**
```typescript
export function sendKeys(options: SendKeysOptions): TmuxResult {
  const { target, text, enter = true, literal = true } = options;
  
  // 发送文字
  const textArgs = literal
    ? ['send-keys', '-t', target, '-l', '--', text]
    : ['send-keys', '-t', target, '--', text];
  
  const textResult = runTmux(textArgs);
  if (!textResult.ok) return textResult;
  
  // 发送回车
  if (enter) {
    const enterResult = runTmux(['send-keys', '-t', target, 'C-m']);
    if (!enterResult.ok) return enterResult;
  }
  
  return textResult;
}
```

#### `sendKeysAsync(options: SendKeysOptions): Promise<TmuxResult>`

```typescript
/**
 * sendKeys 的异步版本。
 * 中间的 delay 使用 await delay(ms) 实现。
 */
export async function sendKeysAsync(options: SendKeysOptions): Promise<TmuxResult>;
```

#### `injectCommand(target: string, command: string, delayMs?: number): Promise<TmuxResult>`

```typescript
/**
 * 高级 API：向 pane 注入完整命令并自动回车。
 * 
 * 等价于 sendKeysAsync({ target, text: command, enter: true, delayBeforeMs: delayMs })
 * 
 * 使用场景：在 agent pane 中自动输入 opencode 命令或 prompt
 */
export async function injectCommand(target: string, command: string, delayMs?: number): Promise<TmuxResult>;
```

### 3.7 输出捕获

#### `capturePane(target: string, lines?: number): string | null`

```typescript
/**
 * 捕获 tmux pane 的最近 N 行输出。
 * 
 * tmux capture-pane -t {target} -p -S -{lines}
 * 
 * -p: 打印到 stdout（不复制到 buffer）
 * -S -N: 从倒数第 N 行开始
 * 
 * 返回捕获到的文本，失败返回 null。
 * 
 * 参考实现：oh-my-codex/src/team/tmux-session.ts → capturePaneAsync()
 */
export function capturePane(target: string, lines: number = 50): string | null;
```

#### `captureVisiblePane(target: string): string | null`

```typescript
/**
 * 仅捕获 pane 可见区域的内容（不包含滚动回溯）。
 * 
 * tmux capture-pane -t {target} -p -E 1
 * 或 tmux capture-pane -t {target} -p（默认就是可见区域）
 * 
 * 参考实现：oh-my-codex/src/team/tmux-session.ts → captureVisiblePaneAsync()
 */
export function captureVisiblePane(target: string): string | null;
```

### 3.8 就绪检测

#### `waitForPaneReady(target: string, timeoutMs?: number, readinessCheck?: (capture: string) => boolean): Promise<boolean>`

```typescript
/**
 * 轮询等待 pane 中的 CLI 就绪。
 * 
 * 策略：
 *   1. 初始间隔 150ms，每次翻倍，最大 2000ms
 *   2. 每次间隔后调用 captureVisiblePane(target) 获取 pane 内容
 *   3. 将内容传入 readinessCheck 回调判断是否就绪
 *   4. 默认 readinessCheck 检查 pane 内容非空且不包含常见的启动中标志
 *   5. 超时返回 false
 * 
 * 默认 readinessCheck 逻辑：
 *   - 去除 ANSI escape codes
 *   - trim 后非空
 *   - 不匹配 /loading|starting|initializing/i
 *   - 匹配常见 CLI 就绪标志（如 > 提示符、$ 提示符、或自定义正则）
 * 
 * 参考实现：
 *   oh-my-codex/src/team/tmux-session.ts → waitForWorkerReady()
 *   使用指数退避轮询 + pane 内容分析
 */
export async function waitForPaneReady(
  target: string,
  timeoutMs?: number,         // 默认 30000
  readinessCheck?: (capture: string) => boolean,
): Promise<boolean>;
```

**默认 readinessCheck 实现：**
```typescript
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[A-Za-z])/g;

function normalizeCapture(raw: string): string {
  return raw.replace(ANSI_RE, '').trim();
}

function defaultReadinessCheck(capture: string): boolean {
  const normalized = normalizeCapture(capture);
  if (normalized.length === 0) return false;
  // 排除仍在启动中的状态
  if (/^(loading|starting|initializing|please wait)/i.test(normalized)) return false;
  // 检测常见 CLI 就绪提示符
  return /[>$#]\s*$/.test(normalized) || /ready/i.test(normalized) || normalized.length > 50;
}
```

### 3.9 工具函数

#### `shellQuote(value: string): string`

```typescript
/**
 * Shell 单引号转义。
 * 将值包裹在单引号中，内部单引号用 '\'' 转义。
 * 示例：hello → 'hello'  |  it's → 'it'"'"'s'
 * 
 * 注意：此函数应从 launcher.ts 移到 tmux.ts 并在 launcher.ts 中 re-export，
 * 或放到一个共享的 utils 中。当前先在 tmux.ts 中独立实现。
 */
export function shellQuote(value: string): string;
```

#### `buildEnvPrefix(env?: NodeJS.ProcessEnv): string`

```typescript
/**
 * 将环境变量对象转换为 shell 环境变量前缀字符串。
 * 如 { FOO: 'bar', BAZ: 'qux' } → "FOO='bar' BAZ='qux'"
 * undefined 值跳过。
 */
export function buildEnvPrefix(env?: NodeJS.ProcessEnv): string;
```

#### `delay(ms: number): Promise<void>`

```typescript
/** Promise 延迟工具 */
export function delay(ms: number): Promise<void>;
```

---

## 4. 详细需求：`src/launcher.ts` 改造

### 4.1 新增 `splitPaneLauncher`

```typescript
/**
 * 在当前 tmux window 中 split 出新 pane 来启动命令。
 * 
 * 前置条件：isInsideTmux() && isTmuxAvailable()
 * 
 * 流程：
 *   1. 调用 tmux.createSplitPane() 创建新 pane
 *   2. 返回一个 "虚拟" ChildProcess（因为 split-window 的进程是 tmux 管理的，
 *      不是我们 spawn 的子进程）
 * 
 * 注意：split-window 本身不是通过 spawn 启动子进程，
 * 而是 tmux server 管理 pane 中的进程。
 * 因此需要返回一个包装后的 ChildProcess-like 对象。
 * 
 * 实现策略：
 *   - 用 spawn 创建一个轻量级 "watcher" 进程，它什么都不做（或 sleep），
 *     但记录了 paneId 信息
 *   - 或者更好的方式：修改 bridge.ts 中 spawnAgent 的 launcher 参数类型，
 *     使其支持返回 { paneId } 而非 ChildProcess
 */
export function splitPaneLauncher(
  command: string,
  args: string[],
  options: LauncherOptions,
): { paneId: string; target: string; pid?: number };
```

### 4.2 修改 `defaultLauncher`

在现有 `tmux new-window` 之前，增加一个分支选项：

```typescript
// 在 defaultLauncher 开头增加：
if (process.env.TMUX && hasCommand('tmux') && process.env.OPENCODE_LAUNCH_MODE === 'split-pane') {
  // 使用 split-pane 模式
  const shellCommand = buildShellCommand(command, args, options);
  const result = createSplitPane({
    direction: 'vertical',
    percentage: 30,
    cwd: options.cwd,
    env: options.env,
    shellCommand,
  });
  // 返回一个 detached 的 sleep 进程作为占位
  return spawn('sleep', ['infinity'], { detached: true, stdio: 'ignore' });
}
```

### 4.3 新增类型

```typescript
export type LaunchMode = 'new-window' | 'split-pane' | 'terminal-app' | 'linux-terminal';

export function detectLaunchMode(): LaunchMode {
  if (process.env.OPENCODE_LAUNCH_MODE === 'split-pane' && process.env.TMUX && hasCommand('tmux')) {
    return 'split-pane';
  }
  return ...  // 现有逻辑
}
```

---

## 5. 详细需求：`src/opencode.ts` 改造

### 5.1 新增 `autoStartCli`

```typescript
/**
 * 在指定 tmux pane 中自动启动 opencode CLI 并等待就绪。
 * 
 * 流程：
 *   1. 通过 tmux.sendKeys 向 pane 注入启动命令
 *   2. 等待 CLI 就绪（tmux.waitForPaneReady）
 *   3. 返回 { paneId, ready: boolean }
 * 
 * 启动命令格式（参考 defaultLaunchPlan）：
 *   cd {projectDir} && {env_prefix} opencode attach {serverUrl} --dir {projectDir} --session={sessionId}
 * 
 * @param options - 包含 paneId、serverUrl、sessionId、projectDir、env 等
 * @returns 启动结果
 */
export async function autoStartCli(options: {
  paneId: string;
  serverUrl: string;
  sessionId: string;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{ paneId: string; ready: boolean }>;
```

**实现伪代码：**
```typescript
export async function autoStartCli(options: {
  paneId: string;
  serverUrl: string;
  sessionId: string;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{ paneId: string; ready: boolean }> {
  const { paneId, serverUrl, sessionId, projectDir, env, timeoutMs = 30_000 } = options;
  
  // 1. 构建启动命令
  const envPrefix = buildEnvPrefix(env);
  const command = [
    'cd', shellQuote(projectDir), '&&',
    ...(envPrefix ? [envPrefix] : []),
    'opencode', 'attach', serverUrl,
    '--dir', shellQuote(projectDir),
    `--session=${sessionId}`,
  ].join(' ');
  
  // 2. 注入命令并回车
  await tmux.injectCommand(paneId, command, 200);
  
  // 3. 等待就绪
  const ready = await tmux.waitForPaneReady(paneId, timeoutMs, (capture) => {
    const normalized = tmux.normalizeCapture(capture);
    return normalized.length > 20 && !/^(loading|starting)/i.test(normalized);
  });
  
  return { paneId, ready };
}
```

---

## 6. 详细需求：`src/bridge.ts` 改造

### 6.1 修改 `spawnAgent` 方法

在 `spawnAgent` 方法中，当检测到 tmux 环境且 launch mode 为 `split-pane` 时：

```typescript
// 在 spawnAgent 中，launcher 调用后增加：

if (isInsideTmux() && isTmuxAvailable()) {
  // split-pane 模式：创建新 pane 而非 new-window
  const shellCommand = buildShellCommand(launchPlan.command, launchPlan.args, {
    cwd: this.projectDir,
    env: spawnEnv,
    title: options.name,
  });
  
  const { paneId, target } = createSplitPane({
    direction: 'vertical',
    percentage: 25,
    cwd: this.projectDir,
    env: spawnEnv,
    shellCommand,
  });
  
  // 更新 agent record，记录 paneId
  record.windowId = paneId;  // 复用 windowId 字段存储 paneId
  
  // 可选：自动注入初始 prompt
  if (options.autoRoute) {
    await autoStartCli({
      paneId,
      serverUrl: this.serverUrl!,
      sessionId: session.id,
      projectDir: this.projectDir,
      env: spawnEnv,
    });
  }
}
```

### 6.2 新增构造函数选项

```typescript
export interface BridgeOptions {
  projectDir: string;
  statePath?: string;
  launcher?: ProcessLauncher;
  /** 新增：是否使用 split-pane 模式启动 agent */
  useSplitPane?: boolean;
  /** 新增：split-pane 方向 */
  splitDirection?: 'vertical' | 'horizontal';
  /** 新增：split-pane 百分比 */
  splitPercentage?: number;
  /** 新增：是否自动注入初始 prompt */
  autoRoute?: boolean;
}
```

---

## 7. 详细需求：`src/index.ts` 改造

### 7.1 新增导出

```typescript
// tmux 模块的全部公共 API
export {
  isTmuxAvailable,
  isInsideTmux,
  getCurrentSessionName,
  getCurrentPaneId,
  runTmux,
  runTmuxAsync,
  listSessions,
  hasSession,
  killSession,
  listPanes,
  createSplitPane,
  killPane,
  isPaneAlive,
  resizePane,
  sendKeys,
  sendKeysAsync,
  injectCommand,
  capturePane,
  captureVisiblePane,
  waitForPaneReady,
  shellQuote,
  buildEnvPrefix,
  delay,
} from './tmux.js';

export type {
  TmuxResult,
  TmuxPaneInfo,
  SplitPaneOptions,
  SendKeysOptions,
  SplitPaneResult,
} from './tmux.js';

// launcher 新增
export { splitPaneLauncher, detectLaunchMode } from './launcher.js';
export type { LaunchMode } from './launcher.js';

// opencode 新增
export { autoStartCli } from './opencode.js';
```

---

## 8. 测试需求

### 8.1 新增测试文件 `test/tmux.test.ts`

测试策略：mock `spawnSync` / `execFile`，不依赖真实 tmux 环境。

```
测试用例清单：

1. isTmuxAvailable
   - tmux -V 返回 0 → true
   - tmux -V 返回非零 → false
   - tmux 不存在(ENOENT) → false
   - 结果缓存：第二次调用不重新检测

2. isInsideTmux
   - TMUX 环境变量存在 → true
   - TMUX 环境变量不存在 → false

3. runTmux
   - 成功时返回 { ok: true, stdout }
   - 失败时返回 { ok: false, stderr }
   - 命令不存在时的错误处理

4. createSplitPane
   - 垂直分割，返回 paneId 和 target
   - 水平分割
   - 指定 size 和 percentage
   - 不在 tmux 内时抛出 Error
   - tmux 命令失败时抛出 Error

5. sendKeys
   - literal 模式 + 回车
   - 非 literal 模式
   - 不发送回车 (enter: false)

6. capturePane
   - 成功返回 pane 内容
   - 失败返回 null

7. waitForPaneReady
   - 就绪后返回 true
   - 超时返回 false
   - 自定义 readinessCheck

8. killPane
   - paneId 以 % 开头 → 正确调用 tmux kill-pane
   - paneId 不以 % 开头 → 返回 false

9. isPaneAlive
   - pane_dead=0 且进程存活 → true
   - pane_dead=1 → false
```

---

## 9. 文件变更总结

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/tmux.ts` | **新增** | tmux 底层操作模块，~350 行 |
| `src/launcher.ts` | 修改 | 增加 splitPaneLauncher、detectLaunchMode、LaunchMode 类型 |
| `src/opencode.ts` | 修改 | 增加 autoStartCli 函数 |
| `src/bridge.ts` | 修改 | spawnAgent 支持 split-pane 模式，新增 BridgeOptions 字段 |
| `src/index.ts` | 修改 | 导出 tmux 模块和新 API |
| `test/tmux.test.ts` | **新增** | tmux 模块单元测试 |

---

## 10. 关键实现注意事项

### 10.1 tmux send-keys 的 `-l` 标志

`-l` (literal) 标志至关重要。没有 `-l`，tmux 会把特殊字符（如 `.`、`!`）解释为按键名的一部分。参考 oh-my-codex：

```typescript
// 正确：literal 模式
runTmux(['send-keys', '-t', target, '-l', '--', text]);
// 然后：
runTmux(['send-keys', '-t', target, 'C-m']);  // 回车
```

### 10.2 pane target 格式

tmux 支持多种 target 格式，本项目统一使用：
- paneId: `%0`, `%5` 等（最可靠，跨 session 唯一）
- session:window.pane: `my-session:0.1`（用于跨 session 操作）

### 10.3 ANSI escape codes 处理

`capture-pane` 返回的文本包含 ANSI escape codes（颜色、光标控制等）。必须清洗后再分析：

```typescript
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[A-Za-z])/g;
function normalizeCapture(raw: string): string {
  return raw.replace(ANSI_RE, '').trim();
}
```

### 10.4 环境变量传递

tmux `split-window` 不直接支持 `-e KEY=VALUE` 参数（某些版本支持但兼容性差）。通过 shell 命令前缀传递：

```bash
# 在 shellCommand 前拼接环境变量
KEY1='value1' KEY2='value2' actual-command arg1 arg2
```

### 10.5 异步 vs 同步

- `runTmux`（同步）— 用于简单操作（检测、查询），不阻塞事件循环太久
- `runTmuxAsync`（异步）— 用于可能耗时较长的操作，或需要与 `delay` 交替使用的场景
- `waitForPaneReady` 必须是异步的（轮询 + 延迟）

### 10.6 进程管理

tmux split-window 创建的 pane 中的进程不由 Node.js 管理（不是 `ChildProcess`）。`bridge.ts` 中现有的 `bindProcess` 模式不完全适用。对于 split-pane 模式：

- 使用 `paneId` 替代 `pid` 进行进程跟踪
- 使用 `isPaneAlive(paneId)` 替代 `process.kill(pid, 0)` 进行存活检测
- 使用 `killPane(paneId)` 替代 `process.kill(pid, 'SIGTERM')` 进行停止

### 10.7 向后兼容

所有新增功能通过 opt-in 机制启用：
- `BridgeOptions.useSplitPane` 默认为 `false`
- `process.env.OPENCODE_LAUNCH_MODE` 环境变量控制 CLI 行为
- 不设这些选项时，行为与当前完全一致
