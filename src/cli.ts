#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCodeBridge, makeStatePath } from './index.js';

type CliBridge = Pick<
  OpenCodeBridge,
  'start' | 'connectExisting' | 'shutdown' | 'stop' | 'readStatus' | 'spawnAgent' | 'route' | 'restartAgent'
>;

type CliDependencies = {
  createBridge?: (options: { projectDir: string; statePath: string }) => CliBridge;
  write?: (value: string) => void;
  waitForShutdownSignal?: () => Promise<void>;
};

function usage(): string {
  return `Usage:
  opencode-bridge status [--project DIR]
  opencode-bridge start [--project DIR]
  opencode-bridge stop [--project DIR]
  opencode-bridge spawn --name NAME [--api-key KEY] [--base-url URL] [--model MODEL] [--project DIR]
  opencode-bridge route --text PROMPT [--agent ID] [--project DIR]
  opencode-bridge restart --agent ID [--project DIR]
`;
}

function takeOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${name}`);
  }
  return value;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function createDefaultBridge(options: { projectDir: string; statePath: string }): CliBridge {
  return new OpenCodeBridge(options);
}

function writeJson(value: unknown, write: (line: string) => void): void {
  write(JSON.stringify(redactSecrets(value), null, 2));
}

export function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolvePromise) => {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    const onSignal = () => {
      for (const signal of signals) {
        process.off(signal, onSignal);
      }
      resolvePromise();
    };

    for (const signal of signals) {
      process.on(signal, onSignal);
    }
  });
}

export async function runCli(argv: string[], deps: CliDependencies = {}): Promise<void> {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error(usage());
  }

  const write = deps.write ?? ((value: string) => process.stdout.write(`${value}\n`));
  const waitForSignal = deps.waitForShutdownSignal ?? waitForShutdownSignal;
  const projectDir = resolve(takeOption(rest, '--project') ?? process.cwd());
  const statePath = takeOption(rest, '--state') ?? makeStatePath(projectDir);
  const bridge = (deps.createBridge ?? createDefaultBridge)({ projectDir, statePath });

  switch (command) {
    case 'start': {
      const snapshot = await bridge.start();
      writeJson(snapshot, write);
      await waitForSignal();
      await bridge.shutdown();
      return;
    }
    case 'status': {
      const snapshot = typeof (bridge as any).readStatus === 'function' ? await bridge.readStatus() : (bridge as any).status();
      writeJson(snapshot, write);
      return;
    }
    case 'spawn': {
      const name = takeOption(rest, '--name');
      if (!name) {
        throw new Error(usage());
      }
      await bridge.connectExisting();
      const agent = await bridge.spawnAgent({
        name,
        role: hasFlag(rest, '--primary') ? 'primary' : 'subagent',
        apiKey: takeOption(rest, '--api-key'),
        baseUrl: takeOption(rest, '--base-url'),
        model: takeOption(rest, '--model'),
      });
      writeJson(agent, write);
      return;
    }
    case 'route': {
      const prompt = takeOption(rest, '--text');
      if (!prompt) {
        throw new Error(usage());
      }
      await bridge.connectExisting();
      const agent = await bridge.route({ agentId: takeOption(rest, '--agent'), prompt });
      writeJson(agent, write);
      return;
    }
    case 'restart': {
      const agentId = takeOption(rest, '--agent');
      if (!agentId) {
        throw new Error(usage());
      }
      await bridge.connectExisting();
      const agent = await bridge.restartAgent(agentId);
      writeJson(agent, write);
      return;
    }
    case 'stop':
    case 'shutdown': {
      const snapshot = await bridge.stop();
      writeJson(snapshot, write);
      return;
    }
    default:
      throw new Error(usage());
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === 'apiKey' && typeof entry === 'string') {
        return [key, maskSecret(entry)];
      }
      return [key, redactSecrets(entry)];
    }),
  );
}

function maskSecret(value: string): string {
  return value.length <= 4 ? '****' : `${value.slice(0, 2)}***${value.slice(-2)}`;
}
