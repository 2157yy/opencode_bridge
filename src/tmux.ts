import { execFile, spawn, execFileSync, spawnSync, type ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TmuxResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string };

export interface TmuxPaneInfo {
  paneId: string;
  panePid: number;
  currentCommand: string;
  startCommand: string;
  sessionName: string;
  windowIndex: number;
  paneWidth: number;
  paneHeight: number;
}

export interface SplitPaneOptions {
  direction?: 'vertical' | 'horizontal';
  size?: number;
  percentage?: number;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  detached?: boolean;
  shellCommand?: string;
}

export interface SendKeysOptions {
  target: string;
  text: string;
  enter?: boolean;
  delayBeforeMs?: number;
  literal?: boolean;
}

export interface SplitPaneResult {
  paneId: string;
  target: string;
}

// ---------------------------------------------------------------------------
// ANSI normalization helpers
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[A-Za-z])/g;

export function normalizeCapture(raw: string): string {
  return raw.replace(ANSI_RE, '').trim();
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildEnvPrefix(env?: NodeJS.ProcessEnv): string {
  if (!env) return '';
  const entries = Object.entries(env).filter(([, v]) => v !== undefined);
  return entries.map(([key, value]) => `${key}=${shellQuote(String(value))}`).join(' ');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

let cachedTmuxAvailable: boolean | undefined;

export function isTmuxAvailable(): boolean {
  if (cachedTmuxAvailable !== undefined) {
    return cachedTmuxAvailable;
  }
  try {
    const result = spawnSync('tmux', ['-V'], { encoding: 'utf-8' });
    cachedTmuxAvailable = result.status === 0;
  } catch {
    cachedTmuxAvailable = false;
  }
  return cachedTmuxAvailable;
}

export function isInsideTmux(): boolean {
  return Boolean(process.env.TMUX && process.env.TMUX.trim().length > 0);
}

export function getCurrentSessionName(): string | null {
  if (!isInsideTmux()) return null;
  try {
    const result = spawnSync('tmux', ['display-message', '-p', '#S'], { encoding: 'utf-8' });
    if (result.status !== 0) return null;
    const name = (result.stdout || '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export function getCurrentPaneId(): string | null {
  // Fast path: TMUX_PANE env var is set
  const envPane = process.env.TMUX_PANE;
  if (envPane && /^%\d+$/.test(envPane)) {
    return envPane;
  }
  // Fallback: query tmux
  if (!isInsideTmux()) return null;
  try {
    const result = spawnSync('tmux', ['display-message', '-p', '#{pane_id}'], { encoding: 'utf-8' });
    if (result.status !== 0) return null;
    const paneId = (result.stdout || '').trim();
    return paneId.startsWith('%') ? paneId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

export function runTmux(args: string[]): TmuxResult {
  try {
    const result = spawnSync('tmux', args, { encoding: 'utf-8' });
    if (result.error) {
      return { ok: false, stderr: result.error.message };
    }
    if (result.status !== 0) {
      return { ok: false, stderr: (result.stderr || '').trim() || `tmux exited ${result.status}` };
    }
    return { ok: true, stdout: (result.stdout || '').trim() };
  } catch (error) {
    return { ok: false, stderr: error instanceof Error ? error.message : String(error) };
  }
}

export async function runTmuxAsync(args: string[]): Promise<TmuxResult> {
  return new Promise((resolve) => {
    const proc = spawn('tmux', args);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, stderr: stderr.trim() || `tmux exited ${code}` });
      } else {
        resolve({ ok: true, stdout: stdout.trim() });
      }
    });

    proc.on('error', (error) => {
      resolve({ ok: false, stderr: error.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export function listSessions(): string[] {
  const result = runTmux(['list-sessions', '-F', '#{session_name}']);
  if (!result.ok) return [];
  if (!result.stdout) return [];
  return result.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function hasSession(name: string): boolean {
  const result = runTmux(['has-session', '-t', name]);
  return result.ok;
}

export function killSession(name: string): boolean {
  const result = runTmux(['kill-session', '-t', name]);
  return result.ok;
}

// ---------------------------------------------------------------------------
// Pane management
// ---------------------------------------------------------------------------

export function listPanes(target?: string): TmuxPaneInfo[] {
  const args = target
    ? ['list-panes', '-t', target, '-F', '#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_start_command}\t#{session_name}\t#{window_index}\t#{pane_width}\t#{pane_height}']
    : ['list-panes', '-F', '#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_start_command}\t#{session_name}\t#{window_index}\t#{pane_width}\t#{pane_height}'];

  const result = runTmux(args);
  if (!result.ok) return [];

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [paneId, panePid, currentCommand, startCommand, sessionName, windowIndex, paneWidth, paneHeight] = line.split('\t');
      return {
        paneId: paneId || '',
        panePid: Number.parseInt(panePid || '0', 10),
        currentCommand: currentCommand || '',
        startCommand: startCommand || '',
        sessionName: sessionName || '',
        windowIndex: Number.parseInt(windowIndex || '0', 10),
        paneWidth: Number.parseInt(paneWidth || '0', 10),
        paneHeight: Number.parseInt(paneHeight || '0', 10),
      };
    })
    .filter((p) => p.paneId.startsWith('%'))
    .sort((a, b) => a.paneId.localeCompare(b.paneId));
}

export function createSplitPane(options: SplitPaneOptions): SplitPaneResult {
  if (!isInsideTmux() || !isTmuxAvailable()) {
    throw new Error('tmux is not available or not inside a tmux session');
  }

  const dirFlag = options.direction === 'horizontal' ? '-h' : '-v';
  const detached = options.detached !== false ? ['-d'] : [];

  const sizeArgs: string[] = [];
  if (options.size != null) {
    sizeArgs.push('-l', String(options.size));
  } else if (options.percentage != null) {
    sizeArgs.push('-p', String(options.percentage));
  }

  const envPrefix = buildEnvPrefix(options.env);

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

  const parts = result.stdout.split('\t');
  const paneId = parts[0] ?? '';
  const target = parts[1] ?? '';

  if (!paneId?.startsWith('%')) {
    throw new Error(`createSplitPane: unexpected output: ${result.stdout}`);
  }

  return { paneId, target };
}

export function killPane(paneId: string): boolean {
  if (!paneId.startsWith('%')) return false;
  const result = runTmux(['kill-pane', '-t', paneId]);
  return result.ok;
}

export function isPaneAlive(paneId: string): boolean {
  if (!paneId.startsWith('%')) return false;
  try {
    const result = spawnSync('tmux', ['list-panes', '-t', paneId, '-F', '#{pane_dead}'], { encoding: 'utf-8' });
    if (result.status !== 0) return false;
    const output = (result.stdout || '').trim();
    if (output === '1') return false;
    if (output === '0') {
      // Check if process is actually alive using pane_pid
      const pidResult = spawnSync('tmux', ['list-panes', '-t', paneId, '-F', '#{pane_pid}'], { encoding: 'utf-8' });
      const pid = Number.parseInt((pidResult.stdout || '').trim(), 10);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

export function resizePane(paneId: string, height: number): boolean {
  if (!paneId.startsWith('%')) return false;
  const result = runTmux(['resize-pane', '-t', paneId, '-y', String(height)]);
  return result.ok;
}

// ---------------------------------------------------------------------------
// Input injection
// ---------------------------------------------------------------------------

export function sendKeys(options: SendKeysOptions): TmuxResult {
  const { target, text, enter = true, literal = true } = options;

  const textArgs = literal
    ? ['send-keys', '-t', target, '-l', '--', text]
    : ['send-keys', '-t', target, '--', text];

  const textResult = runTmux(textArgs);
  if (!textResult.ok) return textResult;

  if (enter) {
    const enterResult = runTmux(['send-keys', '-t', target, 'C-m']);
    if (!enterResult.ok) return enterResult;
  }

  return textResult;
}

export async function sendKeysAsync(options: SendKeysOptions): Promise<TmuxResult> {
  const { target, text, enter = true, literal = true, delayBeforeMs } = options;

  if (delayBeforeMs && delayBeforeMs > 0) {
    await delay(delayBeforeMs);
  }

  const textArgs = literal
    ? ['send-keys', '-t', target, '-l', '--', text]
    : ['send-keys', '-t', target, '--', text];

  const textResult = await runTmuxAsync(textArgs);
  if (!textResult.ok) return textResult;

  if (enter) {
    const enterResult = await runTmuxAsync(['send-keys', '-t', target, 'C-m']);
    if (!enterResult.ok) return enterResult;
  }

  return textResult;
}

export async function injectCommand(target: string, command: string, delayMs?: number): Promise<TmuxResult> {
  return sendKeysAsync({ target, text: command, enter: true, delayBeforeMs: delayMs });
}

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

export function capturePane(target: string, lines: number = 50): string | null {
  const result = runTmux(['capture-pane', '-t', target, '-p', '-S', `-${lines}`]);
  if (!result.ok) return null;
  return result.stdout;
}

export function captureVisiblePane(target: string): string | null {
  const result = runTmux(['capture-pane', '-t', target, '-p']);
  if (!result.ok) return null;
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Readiness detection
// ---------------------------------------------------------------------------

function defaultReadinessCheck(capture: string): boolean {
  const normalized = normalizeCapture(capture);
  if (normalized.length === 0) return false;
  if (/^(loading|starting|initializing|please wait)/i.test(normalized)) return false;
  return /[>$#]\s*$/.test(normalized) || /ready/i.test(normalized) || normalized.length > 50;
}

export async function waitForPaneReady(
  target: string,
  timeoutMs: number = 30_000,
  readinessCheck: (capture: string) => boolean = defaultReadinessCheck,
): Promise<boolean> {
  const start = Date.now();
  let intervalMs = 150;
  const maxIntervalMs = 2000;

  while (Date.now() - start < timeoutMs) {
    const capture = captureVisiblePane(target);
    if (capture && readinessCheck(capture)) {
      return true;
    }
    await delay(intervalMs);
    intervalMs = Math.min(intervalMs * 2, maxIntervalMs);
  }

  return false;
}
