export { OpenCodeBridge, makeStatePath } from './bridge.js';
export type { BridgeOptions, RouteOptions, SpawnAgentOptions } from './bridge.js';
export type { AgentRecord, AgentRole, Artifact, BridgeSnapshot, LlmConfig, RuntimeRecord } from './registry.js';
export { BridgeRegistry } from './registry.js';
export { assertTransition, defaultPhaseForStatus, mapSessionStatus, summarizeSessionStatus } from './state-machine.js';
export { createClient, defaultLaunchPlan, llmConfigToLaunchEnv, startBackend, autoStartCli } from './opencode.js';
export { splitPaneLauncher, detectLaunchMode, buildShellCommand } from './launcher.js';
export type { LaunchMode, LauncherOptions, VisibleLauncherKind } from './launcher.js';
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
  normalizeCapture,
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
