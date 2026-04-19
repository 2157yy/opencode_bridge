/**
 * src/tmux.ts
 *
 * Low-level tmux operations for opencode_bridge.
 * All tmux commands are executed via runTmux() / runTmuxAsync() wrappers.
 *
 * Per PRD_TMUX_INTEGRATION.md §3.
 */
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------
let _cachedTmuxAvailable;
export function _resetCache() {
    _cachedTmuxAvailable = undefined;
}
// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------
/**
 * Detect whether the `tmux` binary is available.
 * Result is cached after first call.
 */
export function isTmuxAvailable() {
    if (_cachedTmuxAvailable !== undefined)
        return _cachedTmuxAvailable;
    const result = spawnSync('tmux', ['-V'], { encoding: 'utf-8' });
    if (result.error) {
        _cachedTmuxAvailable = false;
        return false;
    }
    _cachedTmuxAvailable = result.status === 0;
    return _cachedTmuxAvailable;
}
/**
 * Detect whether the current process is running inside a tmux session.
 */
export function isInsideTmux() {
    return Boolean(process.env.TMUX);
}
/**
 * Get the current tmux session name, or null if unavailable.
 */
export function getCurrentSessionName() {
    if (!process.env.TMUX)
        return null;
    const result = runTmux(['display-message', '-p', '#S']);
    if (!result.ok)
        return null;
    return result.stdout || null;
}
/**
 * Get the current tmux pane ID (e.g. "%0"), or null if unavailable.
 * Checks TMUX_PANE env var first, then falls back to tmux display-message.
 */
export function getCurrentPaneId() {
    const envPane = process.env.TMUX_PANE;
    if (envPane && /^%\d+$/.test(envPane))
        return envPane;
    const result = runTmux(['display-message', '-p', '#{pane_id}']);
    if (!result.ok)
        return null;
    return result.stdout || null;
}
// ---------------------------------------------------------------------------
// Low-level execution
// ---------------------------------------------------------------------------
/**
 * Synchronously execute a tmux subcommand.
 */
export function runTmux(args) {
    const result = spawnSync('tmux', args, { encoding: 'utf-8' });
    if (result.error) {
        return { ok: false, stderr: result.error.message };
    }
    if (result.status !== 0) {
        return { ok: false, stderr: (result.stderr || '').trim() || `tmux exited ${result.status}` };
    }
    return { ok: true, stdout: (result.stdout || '').trim() };
}
/**
 * Asynchronously execute a tmux subcommand.
 */
export async function runTmuxAsync(args) {
    return new Promise((resolve) => {
        execFile('tmux', args, { encoding: 'utf-8' }, (error, stdout, stderr) => {
            if (error) {
                resolve({ ok: false, stderr: error.message });
                return;
            }
            resolve({ ok: true, stdout: (stdout || '').trim() });
        });
    });
}
// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------
/**
 * List all tmux session names. Returns empty array on failure.
 */
export function listSessions() {
    const result = runTmux(['list-sessions', '-F', '#{session_name}']);
    if (!result.ok)
        return [];
    return result.stdout.split('\n').filter(Boolean);
}
/**
 * Check whether a tmux session with the given name exists.
 */
export function hasSession(name) {
    const result = runTmux(['has-session', '-t', name]);
    return result.ok;
}
/**
 * Kill a tmux session. Returns true on success, false on failure.
 */
export function killSession(name) {
    const result = runTmux(['kill-session', '-t', name]);
    return result.ok;
}
// ---------------------------------------------------------------------------
// Pane management
// ---------------------------------------------------------------------------
/**
 * List tmux panes. Returns empty array on failure.
 */
export function listPanes(target) {
    const targetArg = target ? ['-t', target] : [];
    const result = runTmux([
        'list-panes',
        ...targetArg,
        '-F',
        '#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_start_command}\t#{session_name}\t#{window_index}\t#{pane_width}\t#{pane_height}',
    ]);
    if (!result.ok)
        return [];
    return result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
        const [paneId, panePid, currentCommand, startCommand, sessionName, windowIndex, paneWidth, paneHeight] = line.split('\t');
        return {
            paneId,
            panePid: parseInt(panePid, 10),
            currentCommand,
            startCommand,
            sessionName,
            windowIndex: parseInt(windowIndex, 10),
            paneWidth: parseInt(paneWidth, 10),
            paneHeight: parseInt(paneHeight, 10),
        };
    })
        .sort((a, b) => a.paneId.localeCompare(b.paneId));
}
/**
 * Create a new split pane in the current tmux window.
 * Throws if not inside tmux or if tmux command fails.
 */
export function createSplitPane(options) {
    if (!isInsideTmux() || !isTmuxAvailable()) {
        throw new Error('tmux is not available or not inside a tmux session');
    }
    const dirFlag = options.direction === 'horizontal' ? '-h' : '-v';
    const detached = options.detached !== false ? ['-d'] : [];
    // Size args
    const sizeArgs = [];
    if (options.size != null) {
        sizeArgs.push('-l', String(options.size));
    }
    else if (options.percentage != null) {
        sizeArgs.push('-p', String(options.percentage));
    }
    // Environment prefix
    const envPrefix = buildEnvPrefix(options.env);
    // Shell command
    const command = options.shellCommand
        ? envPrefix
            ? `${envPrefix} ${options.shellCommand}`
            : options.shellCommand
        : undefined;
    const args = [
        'split-window',
        dirFlag,
        ...sizeArgs,
        ...detached,
        '-c',
        options.cwd,
        '-P',
        '-F',
        '#{pane_id}\t#{session_name}:#{window_index}.#{pane_index}',
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
/**
 * Kill a tmux pane. Returns true on success, false on failure.
 * Returns false if paneId does not start with '%'.
 */
export function killPane(paneId) {
    if (!paneId.startsWith('%'))
        return false;
    const result = runTmux(['kill-pane', '-t', paneId]);
    return result.ok;
}
/**
 * Check whether a tmux pane is alive.
 * A pane is alive if pane_dead=0 and the process is still running.
 */
export function isPaneAlive(paneId) {
    const result = runTmux(['list-panes', '-t', paneId, '-F', '#{pane_dead} #{pane_pid}']);
    if (!result.ok)
        return false;
    const [deadStr, pidStr] = result.stdout.split(' ');
    if (deadStr === '1')
        return false;
    const pid = parseInt(pidStr, 10);
    if (!pid || pid === 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resize a tmux pane to the given height (rows).
 */
export function resizePane(paneId, height) {
    const result = runTmux(['resize-pane', '-t', paneId, '-y', String(height)]);
    return result.ok;
}
// ---------------------------------------------------------------------------
// Input injection
// ---------------------------------------------------------------------------
/**
 * Send keys / text to a tmux pane.
 */
export function sendKeys(options) {
    const { target, text, enter = true, literal = true } = options;
    const textArgs = literal
        ? ['send-keys', '-t', target, '-l', '--', text]
        : ['send-keys', '-t', target, '--', text];
    const textResult = runTmux(textArgs);
    if (!textResult.ok)
        return textResult;
    if (enter) {
        const enterResult = runTmux(['send-keys', '-t', target, 'C-m']);
        if (!enterResult.ok)
            return enterResult;
    }
    return textResult;
}
/**
 * Asynchronous version of sendKeys.
 */
export async function sendKeysAsync(options) {
    if (options.delayBeforeMs && options.delayBeforeMs > 0) {
        await delay(options.delayBeforeMs);
    }
    return sendKeys(options);
}
/**
 * Convenience: inject a full command into a pane and press Enter.
 */
export async function injectCommand(target, command, delayMs) {
    return sendKeysAsync({ target, text: command, enter: true, delayBeforeMs: delayMs });
}
// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[A-Za-z])/g;
function normalizeCapture(raw) {
    return raw.replace(ANSI_RE, '').trim();
}
/**
 * Capture the last N lines of pane output (includes scrollback).
 */
export function capturePane(target, lines = 50) {
    const result = runTmux(['capture-pane', '-t', target, '-p', '-S', `-${lines}`]);
    if (!result.ok)
        return null;
    return result.stdout;
}
/**
 * Capture only the visible portion of the pane (no scrollback).
 */
export function captureVisiblePane(target) {
    const result = runTmux(['capture-pane', '-t', target, '-p']);
    if (!result.ok)
        return null;
    return result.stdout;
}
// ---------------------------------------------------------------------------
// Readiness detection
// ---------------------------------------------------------------------------
function defaultReadinessCheck(capture) {
    const normalized = normalizeCapture(capture);
    if (normalized.length === 0)
        return false;
    if (/^(loading|starting|initializing|please wait)/i.test(normalized))
        return false;
    return /[>$#]\s*$/.test(normalized) || /ready/i.test(normalized) || normalized.length > 50;
}
/**
 * Poll a pane until readinessCheck returns true, or timeout is reached.
 * Uses exponential backoff starting at 150ms, doubling each time, max 2000ms.
 */
export async function waitForPaneReady(target, timeoutMs = 30_000, readinessCheck = defaultReadinessCheck) {
    const start = Date.now();
    let interval = 150;
    while (Date.now() - start < timeoutMs) {
        const capture = captureVisiblePane(target);
        if (capture != null && readinessCheck(capture)) {
            return true;
        }
        await delay(interval);
        interval = Math.min(interval * 2, 2000);
    }
    return false;
}
// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
/**
 * Shell single-quote escaping: wraps value in single quotes,
 * escaping internal single quotes via '\''.
 * Example: "it's" → "'it'\"'\"'s'"
 */
export function shellQuote(value) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
/**
 * Convert a process env object to a shell environment variable prefix string.
 * Example: { FOO: 'bar', BAZ: 'qux' } → "FOO='bar' BAZ='qux'"
 * Undefined values are skipped.
 */
export function buildEnvPrefix(env) {
    if (!env)
        return '';
    const entries = Object.entries(env).filter(([, value]) => value !== undefined);
    return entries.map(([key, value]) => `${key}=${shellQuote(String(value))}`).join(' ');
}
/** Promise-based delay */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
