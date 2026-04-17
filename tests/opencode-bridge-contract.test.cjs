const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const prdPath = path.join(repoRoot, '.omx', 'plans', 'prd-opencode-agent-bridge.md');
const testSpecPath = path.join(repoRoot, '.omx', 'plans', 'test-spec-opencode-agent-bridge.md');

function readDoc(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectContainsAll(haystack, needles, label) {
  for (const needle of needles) {
    assert.match(
      haystack,
      needle instanceof RegExp ? needle : new RegExp(escapeRegExp(needle)),
      `${label} is missing required text: ${needle}`,
    );
  }
}

function expectContainsAny(haystack, needles, label) {
  assert.ok(
    needles.some((needle) => {
      const pattern = needle instanceof RegExp ? needle : new RegExp(escapeRegExp(needle));
      return pattern.test(haystack);
    }),
    `${label} is missing all accepted variants: ${needles.join(' | ')}`,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('PRD captures the independent-CLI bridge contract', () => {
  const prd = readDoc(prdPath);

  expectContainsAll(prd, [
    '独立 CLI 进程 / 独立终端窗口',
    '主 CLI 是人类默认入口',
    '子 CLI 可被人类直接点名',
    '桥作为通路与编排层，负责启动、路由、状态记录、可观测性汇总',
    '不要求展示完整消息中转过程',
    '监督重点是每个子智能体的 **任务状态 / 阶段 / 产物**',
  ], 'PRD');
});

test('test spec covers the requested verification ladder', () => {
  const spec = readDoc(testSpecPath);

  expectContainsAll(spec, [
    '### Unit',
    '### Integration',
    '### E2E',
    '### Manual / UX',
    'T1 主入口',
    'T2 子 CLI 独立进程',
    'T3 直接点名子 CLI',
    'T4 状态监督',
    'T5 不暴露消息原文也能监督',
    'T6 故障与恢复',
    '主 CLI 与子 CLI 都是独立进程 / 窗口',
    '路由支持默认到主 CLI 和显式到任意子 CLI',
    '监督面板至少能展示状态、阶段、产物三类信息',
    '消息原文不是监督的必要条件',
    '异常退出可以被检测并恢复',
  ], 'Test spec');
});

test('acceptance criteria are cross-walked into test cases', () => {
  const prd = readDoc(prdPath);
  const spec = readDoc(testSpecPath);

  const crosswalk = [
    ['主 CLI 默认入口', 'T1 主入口', '主 CLI 是人类默认入口'],
    ['多个子 CLI 独立窗口', 'T2 子 CLI 独立进程', '独立 CLI 进程 / 独立终端窗口'],
    ['直达指定子 CLI', 'T3 直接点名子 CLI', ['支持显式路由到指定子 CLI', '子 CLI 可被人类直接点名']],
    ['状态 / 阶段 / 产物', 'T4 状态监督', '状态 / 阶段 / 产物'],
    ['不暴露原文即可监督', 'T5 不暴露消息原文也能监督', ['不要求展示完整消息中转过程', '桥无需暴露完整消息中转即可完成监督']],
    ['异常退出可检测并恢复', 'T6 故障与恢复', ['桥标记为 failed', '状态可被正确标记']],
  ];

  for (const [criterion, testCase, prdPhrases] of crosswalk) {
    assert.match(spec, new RegExp(escapeRegExp(testCase)), `test spec is missing mapping for: ${criterion}`);
    const acceptedPhrases = Array.isArray(prdPhrases) ? prdPhrases : [prdPhrases];
    expectContainsAny(prd, acceptedPhrases, `PRD is missing coverage for: ${criterion}`);
  }
});
