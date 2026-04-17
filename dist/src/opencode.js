import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';
export async function startBackend(options) {
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
export function createClient(options) {
    return createOpencodeClient({
        baseUrl: options.baseUrl,
        directory: options.projectDir,
    });
}
export function llmConfigToLaunchEnv(llmConfig) {
    if (!llmConfig) {
        return undefined;
    }
    const env = {};
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
export function defaultLaunchPlan(options) {
    const llmConfig = options.llmConfig ?? pickFlatLlm(options);
    return {
        command: 'opencode',
        args: ['attach', options.serverUrl, '--dir', options.projectDir, `--session=${options.sessionId}`],
        env: llmConfigToLaunchEnv(llmConfig),
    };
}
function pickFlatLlm(options) {
    const llmConfig = {
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        ...(options.model ? { model: options.model } : {}),
    };
    return Object.keys(llmConfig).length > 0 ? llmConfig : undefined;
}
