import { assert, test } from 'poku';
import { __internal } from '../src/plugin.ts';

const ORIGINAL_DOM_URL = process.env.POKU_REACT_DOM_URL;
const ORIGINAL_METRICS = process.env.POKU_REACT_ENABLE_METRICS;

const restoreEnvBaseline = () => {
  if (typeof ORIGINAL_DOM_URL === 'undefined') {
    delete process.env.POKU_REACT_DOM_URL;
  } else {
    process.env.POKU_REACT_DOM_URL = ORIGINAL_DOM_URL;
  }

  if (typeof ORIGINAL_METRICS === 'undefined') {
    delete process.env.POKU_REACT_ENABLE_METRICS;
  } else {
    process.env.POKU_REACT_ENABLE_METRICS = ORIGINAL_METRICS;
  }
};

test('normalizes metrics defaults when disabled', () => {
  const normalized = __internal.normalizeMetricsOptions(undefined);

  assert.strictEqual(normalized.enabled, false);
  assert.strictEqual(normalized.topN, 5);
  assert.strictEqual(normalized.minDurationMs, 0);
});

test('normalizes metrics with option object', () => {
  const reporterCalls: number[] = [];
  const normalized = __internal.normalizeMetricsOptions({
    enabled: true,
    topN: 9.8,
    minDurationMs: 2.5,
    reporter(summary) {
      reporterCalls.push(summary.totalCaptured);
    },
  });

  assert.strictEqual(normalized.enabled, true);
  assert.strictEqual(normalized.topN, 9);
  assert.strictEqual(normalized.minDurationMs, 2.5);
  assert.strictEqual(typeof normalized.reporter, 'function');
  assert.strictEqual(reporterCalls.length, 0);
});

test('buildRunnerCommand injects tsx and dom setup for node', () => {
  const result = __internal.buildRunnerCommand({
    runtime: 'node',
    command: ['node', '--trace-warnings', 'tests/example.test.tsx'],
    file: 'tests/example.test.tsx',
    domSetupPath: '/tmp/dom-setup.ts',
  });

  assert.strictEqual(result.shouldHandle, true);
  assert.deepStrictEqual(result.command, [
    'node',
    '--trace-warnings',
    '--import=tsx',
    '--import=/tmp/dom-setup.ts',
    'tests/example.test.tsx',
  ]);
});

test('buildRunnerCommand injects dom setup for bun without tsx import', () => {
  const result = __internal.buildRunnerCommand({
    runtime: 'bun',
    command: ['bun', 'tests/example.test.tsx'],
    file: 'tests/example.test.tsx',
    domSetupPath: '/tmp/dom-setup.ts',
  });

  assert.strictEqual(result.shouldHandle, true);
  assert.deepStrictEqual(result.command, [
    'bun',
    '--import=/tmp/dom-setup.ts',
    'tests/example.test.tsx',
  ]);
});

test('buildRunnerCommand injects preload for deno', () => {
  const result = __internal.buildRunnerCommand({
    runtime: 'deno',
    command: ['deno', 'run', '-A', 'tests/example.test.tsx'],
    file: 'tests/example.test.tsx',
    domSetupPath: '/tmp/dom-setup.ts',
  });

  assert.strictEqual(result.shouldHandle, true);
  assert.deepStrictEqual(result.command, [
    'deno',
    'run',
    '-A',
    '--preload=/tmp/dom-setup.ts',
    'tests/example.test.tsx',
  ]);
});

test('buildRunnerCommand leaves unsupported runtime unchanged', () => {
  const original = ['python', 'tests/example.test.tsx'];
  const result = __internal.buildRunnerCommand({
    runtime: 'python',
    command: original,
    file: 'tests/example.test.tsx',
    domSetupPath: '/tmp/dom-setup.ts',
  });

  assert.strictEqual(result.shouldHandle, false);
  assert.deepStrictEqual(result.command, original);
});

test('buildRunnerCommand leaves non-react extension unchanged', () => {
  const original = ['node', 'tests/example.test.ts'];
  const result = __internal.buildRunnerCommand({
    runtime: 'node',
    command: original,
    file: 'tests/example.test.ts',
    domSetupPath: '/tmp/dom-setup.ts',
  });

  assert.strictEqual(result.shouldHandle, false);
  assert.deepStrictEqual(result.command, original);
});

test('environment helpers apply and restore options', () => {
  restoreEnvBaseline();

  const snapshot = __internal.captureEnvSnapshot();
  __internal.applyEnvironmentOptions(
    { domUrl: 'http://example.local/', metrics: true },
    __internal.normalizeMetricsOptions(true),
  );

  assert.strictEqual(process.env.POKU_REACT_DOM_URL, 'http://example.local/');
  assert.strictEqual(process.env.POKU_REACT_ENABLE_METRICS, '1');

  __internal.restoreEnvironmentOptions(snapshot);

  assert.strictEqual(process.env.POKU_REACT_DOM_URL, ORIGINAL_DOM_URL);
  assert.strictEqual(process.env.POKU_REACT_ENABLE_METRICS, ORIGINAL_METRICS);
});

test('createMetricsSummary returns ordered top metrics with filters', () => {
  const metrics = [
    { file: 'a', componentName: 'A', durationMs: 0.4 },
    { file: 'b', componentName: 'B', durationMs: 4.2 },
    { file: 'c', componentName: 'C', durationMs: 3.3 },
  ];

  const summary = __internal.createMetricsSummary(
    metrics,
    __internal.normalizeMetricsOptions({ enabled: true, topN: 2, minDurationMs: 1 }),
  );

  assert.ok(summary);
  assert.strictEqual(summary?.totalCaptured, 3);
  assert.strictEqual(summary?.totalReported, 2);
  assert.deepStrictEqual(
    summary?.topSlowest.map((item) => item.componentName),
    ['B', 'C'],
  );
});

test('createMetricsSummary returns null when disabled', () => {
  const summary = __internal.createMetricsSummary(
    [{ file: 'a', componentName: 'A', durationMs: 8 }],
    __internal.normalizeMetricsOptions(false),
  );

  assert.strictEqual(summary, null);
});

test('getComponentName falls back for non-string values', () => {
  assert.strictEqual(__internal.getComponentName('MyComp'), 'MyComp');
  assert.strictEqual(__internal.getComponentName(''), 'AnonymousComponent');
  assert.strictEqual(__internal.getComponentName(null), 'AnonymousComponent');
});

test('isRenderMetricMessage validates expected payloads', () => {
  assert.strictEqual(__internal.isRenderMetricMessage({ type: 'POKU_REACT_RENDER_METRIC' }), true);
  assert.strictEqual(__internal.isRenderMetricMessage({ type: 'OTHER' }), false);
  assert.strictEqual(__internal.isRenderMetricMessage(null), false);
});

test('resolveDomSetupPath resolves built-in and custom adapters', () => {
  const happyPath = __internal.resolveDomSetupPath('happy-dom');
  const jsdomPath = __internal.resolveDomSetupPath('jsdom');
  const customPath = __internal.resolveDomSetupPath({ setupModule: 'tests/setup/custom.ts' });

  assert.ok(happyPath.includes('dom-setup-happy'));
  assert.ok(jsdomPath.includes('dom-setup-jsdom'));
  assert.ok(customPath.endsWith('/tests/setup/custom.ts'));
});
