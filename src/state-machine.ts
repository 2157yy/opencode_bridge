export type AgentStatus = 'queued' | 'running' | 'blocked' | 'produced' | 'done' | 'failed';

export type SessionStatus =
  | { type: 'idle' }
  | { type: 'retry'; attempt: number; message: string; next: number }
  | { type: 'busy' };

export type Transition = {
  from: AgentStatus;
  to: AgentStatus;
  at: string;
  note?: string;
};

const ALLOWED_TRANSITIONS: Record<AgentStatus, ReadonlyArray<AgentStatus>> = {
  queued: ['running', 'blocked', 'failed'],
  running: ['blocked', 'produced', 'done', 'failed'],
  blocked: ['running', 'produced', 'done', 'failed'],
  produced: ['running', 'done', 'failed'],
  done: ['running', 'failed'],
  failed: ['running', 'queued'],
};

const DEFAULT_PHASE: Record<AgentStatus, string> = {
  queued: 'queued',
  running: 'running',
  blocked: 'blocked',
  produced: 'produced',
  done: 'done',
  failed: 'failed',
};

export function assertTransition(from: AgentStatus, to: AgentStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`invalid agent transition: ${from} -> ${to}`);
  }
}

export function defaultPhaseForStatus(status: AgentStatus): string {
  return DEFAULT_PHASE[status];
}

export function mapSessionStatus(sessionStatus: SessionStatus | undefined): { status: AgentStatus; phase: string } | null {
  if (!sessionStatus) {
    return null;
  }

  switch (sessionStatus.type) {
    case 'busy':
      return { status: 'running', phase: 'busy' };
    case 'retry':
      return { status: 'blocked', phase: `retry:${sessionStatus.attempt}` };
    case 'idle':
      return { status: 'done', phase: 'idle' };
    default:
      return null;
  }
}

export function summarizeSessionStatus(sessionStatus: SessionStatus): string {
  switch (sessionStatus.type) {
    case 'busy':
      return 'session is busy';
    case 'retry':
      return `session retrying (${sessionStatus.message})`;
    case 'idle':
      return 'session is idle';
  }
}
