import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';
import type { ChildProcess } from 'node:child_process';
import type { LlmConfig } from './registry.js';

export type BackendHandle = {
  url: string;
  close: () => void;
};

export type BackendFactoryOptions = {
  projectDir: string;
};

export type ClientFactoryOptions = {
  baseUrl: string;
  projectDir: string;
};

export type LaunchOptions = {
  projectDir: string;
  serverUrl: string;
  sessionId: string;
  agentName: string;
  role: 'primary' | 'subagent';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  llmConfig?: LlmConfig;
};

export type LaunchPlan = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  trackProcessExit?: boolean;
};

export type ProcessLauncher = (
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; title?: string },
) => ChildProcess;

export async function startBackend(options: BackendFactoryOptions): Promise<BackendHandle> {
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    timeout: 10_000,
    config: {},
  });

  return {
    url: server.url,
    close: () => server.close(),
  };
}

export function createClient(options: ClientFactoryOptions) {
  return createOpencodeClient({
    baseUrl: options.baseUrl,
    directory: options.projectDir,
  });
}

export function llmConfigToLaunchEnv(llmConfig?: LlmConfig): NodeJS.ProcessEnv | undefined {
  if (!llmConfig) {
    return undefined;
  }

  const env: NodeJS.ProcessEnv = {};
  if (llmConfig.apiKey) {
    env.OPENCODE_AGENT_API_KEY = llmConfig.apiKey;
    env.OPENAI_API_KEY = llmConfig.apiKey;
  }
  if (llmConfig.baseUrl) {
    env.OPENCODE_AGENT_BASE_URL = llmConfig.baseUrl;
    env.OPENAI_BASE_URL = llmConfig.baseUrl;
  }
  if (llmConfig.model) {
    env.OPENCODE_AGENT_MODEL = llmConfig.model;
    env.OPENCODE_MODEL = llmConfig.model;
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

export function defaultLaunchPlan(options: LaunchOptions): LaunchPlan {
  const llmConfig = options.llmConfig ?? pickFlatLlm(options);
  return {
    command: 'opencode',
    args: ['attach', options.serverUrl, '--dir', options.projectDir, `--session=${options.sessionId}`],
    env: llmConfigToLaunchEnv(llmConfig),
    trackProcessExit: false,
  };
}

function pickFlatLlm(options: Pick<LaunchOptions, 'apiKey' | 'baseUrl' | 'model'>): LlmConfig | undefined {
  const llmConfig = {
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.model ? { model: options.model } : {}),
  };
  return Object.keys(llmConfig).length > 0 ? llmConfig : undefined;
}
