import { spawn, spawnSync } from 'node:child_process';
import { createSplitPane } from './tmux.js';
export function detectLaunchMode() {
    if (process.env.OPENCODE_LAUNCH_MODE === 'split-pane' && process.env.TMUX) {
        return 'split-pane';
    }
    const kind = detectVisibleLauncherKind();
    if (kind === 'tmux')
        return 'new-window';
    if (kind === 'terminal-app')
        return 'terminal-app';
    if (kind === 'linux-terminal')
        return 'linux-terminal';
    return 'new-window';
}
export function defaultLauncher(command, args, options) {
    // Support split-pane mode when inside tmux and OPENCODE_LAUNCH_MODE is set
    if (process.env.OPENCODE_LAUNCH_MODE === 'split-pane' && process.env.TMUX) {
        const result = splitPaneLauncher(command, args, options);
        // Return a dummy ChildProcess-like object with paneId info
        // The actual process management is handled by tmux
        const dummyProc = spawn('sleep', ['infinity'], { detached: true, stdio: 'ignore' });
        dummyProc.unref();
        dummyProc.paneId = result.paneId;
        dummyProc.tmuxTarget = result.target;
        return dummyProc;
    }
    const shellCommand = buildShellCommand(command, args, options);
    const title = normalizeTitle(options.title ?? command);
    if (process.env.TMUX && hasCommand('tmux')) {
        return spawn('tmux', ['new-window', '-n', title, 'sh', '-lc', shellCommand], {
            cwd: options.cwd,
            env: options.env,
            detached: true,
            stdio: 'ignore',
        });
    }
    if (process.platform === 'darwin' && hasCommand('osascript')) {
        const script = `tell application "Terminal" to activate\n` +
            `tell application "Terminal" to do script ${appleScriptQuote(`sh -lc ${shellQuote(shellCommand)}`)}`;
        return spawn('osascript', ['-e', script], {
            cwd: options.cwd,
            env: options.env,
            detached: true,
            stdio: 'ignore',
        });
    }
    if (process.platform === 'linux') {
        for (const launcher of linuxTerminalLaunchers(title, shellCommand)) {
            if (hasCommand(launcher.command)) {
                return spawn(launcher.command, launcher.args, {
                    cwd: options.cwd,
                    env: options.env,
                    detached: true,
                    stdio: 'ignore',
                });
            }
        }
    }
    throw new Error('no supported visible terminal launcher available');
}
export function buildShellCommand(command, args, options) {
    const envPrefix = buildLaunchEnvPrefix(options.env);
    const parts = ['cd', shellQuote(options.cwd), '&&'];
    if (envPrefix) {
        parts.push(envPrefix);
    }
    parts.push(shellQuote(command), ...args.map((arg) => shellQuote(arg)));
    return parts.join(' ');
}
export function detectVisibleLauncherKind() {
    if (process.env.TMUX && hasCommand('tmux')) {
        return 'tmux';
    }
    if (process.platform === 'darwin' && hasCommand('osascript')) {
        return 'terminal-app';
    }
    if (process.platform === 'linux') {
        return linuxTerminalLaunchers('worker', '').find((launcher) => hasCommand(launcher.command)) ? 'linux-terminal' : undefined;
    }
    return undefined;
}
export function splitPaneLauncher(command, args, options) {
    const shellCommand = buildShellCommand(command, args, options);
    const result = createSplitPane({
        direction: 'vertical',
        percentage: 30,
        cwd: options.cwd,
        env: options.env,
        shellCommand,
    });
    // Return a placeholder that keeps the process alive
    // The actual process is managed by tmux
    const proc = spawn('sleep', ['infinity'], { detached: true, stdio: 'ignore' });
    proc.unref();
    return { paneId: result.paneId, target: result.target, pid: proc.pid };
}
function linuxTerminalLaunchers(title, shellCommand) {
    return [
        { command: 'xterm', args: ['-T', title, '-e', 'sh', '-lc', shellCommand] },
        { command: 'gnome-terminal', args: ['--title', title, '--', 'sh', '-lc', shellCommand] },
        { command: 'konsole', args: ['--new-tab', '-p', `tabtitle=${title}`, '-e', 'sh', '-lc', shellCommand] },
    ];
}
function normalizeTitle(value) {
    return value.replace(/\s+/g, ' ').trim().slice(0, 60) || 'opencode';
}
function buildLaunchEnvPrefix(env) {
    if (!env)
        return '';
    const entries = Object.entries(env).filter(([key, value]) => {
        if (value === undefined)
            return false;
        return (key === 'OPENAI_API_KEY' ||
            key === 'OPENAI_BASE_URL' ||
            key === 'OPENCODE_MODEL' ||
            key === 'OPENCODE_AGENT_API_KEY' ||
            key === 'OPENCODE_AGENT_BASE_URL' ||
            key === 'OPENCODE_AGENT_MODEL');
    });
    return entries.map(([key, value]) => `${key}=${shellQuote(String(value))}`).join(' ');
}
function hasCommand(binary) {
    const result = spawnSync('sh', ['-lc', `command -v ${shellQuote(binary)} >/dev/null 2>&1`], {
        stdio: 'ignore',
    });
    return result.status === 0;
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
function appleScriptQuote(value) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}
