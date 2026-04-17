const ALLOWED_TRANSITIONS = {
    queued: ['running', 'blocked', 'failed'],
    running: ['blocked', 'produced', 'done', 'failed'],
    blocked: ['running', 'produced', 'done', 'failed'],
    produced: ['running', 'done', 'failed'],
    done: ['running', 'failed'],
    failed: ['running', 'queued'],
};
const DEFAULT_PHASE = {
    queued: 'queued',
    running: 'running',
    blocked: 'blocked',
    produced: 'produced',
    done: 'done',
    failed: 'failed',
};
export function assertTransition(from, to) {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new Error(`invalid agent transition: ${from} -> ${to}`);
    }
}
export function defaultPhaseForStatus(status) {
    return DEFAULT_PHASE[status];
}
export function mapSessionStatus(sessionStatus) {
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
export function summarizeSessionStatus(sessionStatus) {
    switch (sessionStatus.type) {
        case 'busy':
            return 'session is busy';
        case 'retry':
            return `session retrying (${sessionStatus.message})`;
        case 'idle':
            return 'session is idle';
    }
}
