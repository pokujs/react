import { definePlugin } from 'poku/plugins';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const resolveSetupModulePath = (baseName: string) => {
	const jsPath = resolve(currentDir, `${baseName}.js`);
	if (existsSync(jsPath)) return jsPath;

	return resolve(currentDir, `${baseName}.ts`);
};

const happyDomSetupPath = resolveSetupModulePath('dom-setup-happy');
const jsdomSetupPath = resolveSetupModulePath('dom-setup-jsdom');

const reactExtensions = new Set(['.tsx', '.jsx']);

export type ReactDomAdapter = 'happy-dom' | 'jsdom' | { setupModule: string };

export type ReactTestingPluginOptions = {
	/**
	 * DOM implementation used by test file processes.
	 *
	 * - `happy-dom`: fast default suitable for most component tests.
	 * - `jsdom`: broader compatibility for browser-like APIs.
	 * - `{ setupModule }`: custom module that prepares globals.
	 */
	dom?: ReactDomAdapter;
	/**
	 * URL assigned to the DOM environment.
	 */
	domUrl?: string;
	/**
	 * Render metrics configuration. Disabled by default for production-safe behavior.
	 */
	metrics?: boolean | ReactMetricsOptions;
};

export type ReactMetricsSummary = {
	totalCaptured: number;
	totalReported: number;
	topSlowest: RenderMetric[];
};

export type ReactMetricsOptions = {
	/**
	 * Enable or disable render metrics collection.
	 */
	enabled?: boolean;
	/**
	 * Maximum number of rows to display/report.
	 * @default 5
	 */
	topN?: number;
	/**
	 * Minimum duration to include in the final report.
	 * @default 0
	 */
	minDurationMs?: number;
	/**
	 * Custom reporter. Falls back to console output when omitted.
	 */
	reporter?: (summary: ReactMetricsSummary) => void;
};

type RenderMetricMessage = {
	type: 'POKU_REACT_RENDER_METRIC';
	componentName?: string;
	durationMs?: number;
};

type RenderMetric = {
	file: string;
	componentName: string;
	durationMs: number;
};

type NormalizedMetricsOptions = {
	enabled: boolean;
	topN: number;
	minDurationMs: number;
	reporter?: (summary: ReactMetricsSummary) => void;
};

type RuntimeSupport = {
	supportsNodeLikeImport: boolean;
	supportsDenoPreload: boolean;
};

type BuildRunnerCommandInput = {
	runtime: string;
	command: string[];
	file: string;
	domSetupPath: string;
};

type BuildRunnerCommandOutput = {
	shouldHandle: boolean;
	command: string[];
};

type EnvSnapshot = {
	previousDomUrl: string | undefined;
	previousMetricsFlag: string | undefined;
};

const DEFAULT_TOP_N = 5;
const DEFAULT_MIN_DURATION_MS = 0;

const isRenderMetricMessage = (message: unknown): message is RenderMetricMessage => {
	if (!message || typeof message !== 'object') return false;
	return (message as Record<string, unknown>).type === 'POKU_REACT_RENDER_METRIC';
};

const getComponentName = (componentName: unknown) =>
	typeof componentName === 'string' && componentName.length > 0
		? componentName
		: 'AnonymousComponent';

const isTsxImport = (arg: string) => arg === '--import=tsx' || arg === '--loader=tsx';
const isNodeRuntime = (runtime: string) => runtime === 'node';
const isBunRuntime = (runtime: string) => runtime === 'bun';
const isDenoRuntime = (runtime: string) => runtime === 'deno';

const getRuntimeSupport = (runtime: string): RuntimeSupport => ({
	supportsNodeLikeImport: isNodeRuntime(runtime) || isBunRuntime(runtime),
	supportsDenoPreload: isDenoRuntime(runtime),
});

const canHandleRuntime = (runtime: string) => {
	const support = getRuntimeSupport(runtime);
	return support.supportsNodeLikeImport || support.supportsDenoPreload;
};

const resolveDomSetupPath = (adapter: ReactDomAdapter | undefined) => {
 	if (!adapter || adapter === 'happy-dom') return happyDomSetupPath;
	if (adapter === 'jsdom') return jsdomSetupPath;

 	return resolve(process.cwd(), adapter.setupModule);
};

const getPositiveIntegerOrDefault = (value: unknown, fallback: number) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
	return Math.floor(numeric);
};

const getNonNegativeNumberOrDefault = (value: unknown, fallback: number) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric < 0) return fallback;
	return numeric;
};

const normalizeMetricsOptions = (
	metrics: ReactTestingPluginOptions['metrics'],
): NormalizedMetricsOptions => {
	if (metrics === true) {
		return {
			enabled: true,
			topN: DEFAULT_TOP_N,
			minDurationMs: DEFAULT_MIN_DURATION_MS,
		};
	}

	if (!metrics) {
		return {
			enabled: false,
			topN: DEFAULT_TOP_N,
			minDurationMs: DEFAULT_MIN_DURATION_MS,
		};
	}

	const normalized: NormalizedMetricsOptions = {
		enabled: metrics.enabled ?? true,
		topN: getPositiveIntegerOrDefault(metrics.topN, DEFAULT_TOP_N),
		minDurationMs: getNonNegativeNumberOrDefault(metrics.minDurationMs, DEFAULT_MIN_DURATION_MS),
	};

	if (metrics.reporter) normalized.reporter = metrics.reporter;

	return normalized;
};

const buildRunnerCommand = ({
	runtime,
	command,
	file,
	domSetupPath,
}: BuildRunnerCommandInput): BuildRunnerCommandOutput => {
	const support = getRuntimeSupport(runtime);

	if (!support.supportsNodeLikeImport && !support.supportsDenoPreload) {
		return { shouldHandle: false, command };
	}

	if (!reactExtensions.has(extname(file))) {
		return { shouldHandle: false, command };
	}

	const fileIndex = command.lastIndexOf(file);
	if (fileIndex === -1) return { shouldHandle: false, command };

	const beforeFile = command.slice(1, fileIndex);
	const afterFile = command.slice(fileIndex + 1);

	const hasTsx = beforeFile.some(isTsxImport);
	const hasNodeLikeDomSetup = beforeFile.some((arg) => arg === `--import=${domSetupPath}`);
	const hasDenoDomSetup = beforeFile.some((arg) => arg === `--preload=${domSetupPath}`);

	const extraImports: string[] = [];
	if (isNodeRuntime(runtime) && !hasTsx) extraImports.push('--import=tsx');
	if (support.supportsNodeLikeImport && !hasNodeLikeDomSetup) extraImports.push(`--import=${domSetupPath}`);
	if (support.supportsDenoPreload && !hasDenoDomSetup) extraImports.push(`--preload=${domSetupPath}`);

	return {
		shouldHandle: true,
		command: [runtime, ...beforeFile, ...extraImports, file, ...afterFile],
	};
};

const captureEnvSnapshot = (): EnvSnapshot => ({
	previousDomUrl: process.env.POKU_REACT_DOM_URL,
	previousMetricsFlag: process.env.POKU_REACT_ENABLE_METRICS,
});

const applyEnvironmentOptions = (options: ReactTestingPluginOptions, metricsOptions: NormalizedMetricsOptions) => {
	if (options.domUrl) {
		process.env.POKU_REACT_DOM_URL = options.domUrl;
	}

	if (metricsOptions.enabled) {
		process.env.POKU_REACT_ENABLE_METRICS = '1';
	}
};

const restoreEnvironmentOptions = (snapshot: EnvSnapshot) => {
	if (typeof snapshot.previousDomUrl === 'undefined') {
		delete process.env.POKU_REACT_DOM_URL;
	} else {
		process.env.POKU_REACT_DOM_URL = snapshot.previousDomUrl;
	}

	if (typeof snapshot.previousMetricsFlag === 'undefined') {
		delete process.env.POKU_REACT_ENABLE_METRICS;
	} else {
		process.env.POKU_REACT_ENABLE_METRICS = snapshot.previousMetricsFlag;
	}
};

const selectTopSlowestMetrics = (metrics: RenderMetric[], options: NormalizedMetricsOptions) =>
	[...metrics]
		.filter((metric) => metric.durationMs >= options.minDurationMs)
		.sort((a, b) => b.durationMs - a.durationMs)
		.slice(0, options.topN);

const createMetricsSummary = (
	metrics: RenderMetric[],
	options: NormalizedMetricsOptions,
): ReactMetricsSummary | null => {
	if (!options.enabled || metrics.length === 0) return null;

	const topSlowest = selectTopSlowestMetrics(metrics, options);
	if (topSlowest.length === 0) return null;

	return {
		totalCaptured: metrics.length,
		totalReported: topSlowest.length,
		topSlowest,
	};
};

const printMetricsSummary = (summary: ReactMetricsSummary) => {
	const lines = summary.topSlowest.map(
		(metric) =>
			`  - ${metric.componentName} in ${metric.file}: ${metric.durationMs.toFixed(2)}ms`,
	);

	console.log('\n[poku-react-testing] Slowest component renders');
	for (const line of lines) console.log(line);
};

/**
 * Create a Poku plugin that prepares DOM globals and TSX execution for React tests.
 */
export const createReactTestingPlugin = (options: ReactTestingPluginOptions = {}) => {
	const metrics: RenderMetric[] = [];
	const envSnapshot = captureEnvSnapshot();
	const domSetupPath = resolveDomSetupPath(options.dom);
	const metricsOptions = normalizeMetricsOptions(options.metrics);

	applyEnvironmentOptions(options, metricsOptions);

	return definePlugin({
		name: 'react-testing',
		ipc: metricsOptions.enabled,

		runner(command, file) {
			const runtime = command[0];
			if (!runtime) return command;
			const result = buildRunnerCommand({
				runtime,
				command,
				file,
				domSetupPath,
			});

			return result.command;
		},

		onTestProcess(child, file) {
			if (!metricsOptions.enabled) return;

			child.on('message', (message) => {
				if (!isRenderMetricMessage(message)) return;

				metrics.push({
					file,
					componentName: getComponentName(message.componentName),
					durationMs: Number(message.durationMs) || 0,
				});
			});
		},

		teardown() {
			restoreEnvironmentOptions(envSnapshot);

			const summary = createMetricsSummary(metrics, metricsOptions);
			if (!summary) return;

			if (metricsOptions.reporter) {
				metricsOptions.reporter(summary);
				return;
			}

			printMetricsSummary(summary);
		},
	});
};

/**
 * Alias for `createReactTestingPlugin`.
 */
export const reactTestingPlugin = createReactTestingPlugin;

export const __internal = {
	buildRunnerCommand,
	canHandleRuntime,
	captureEnvSnapshot,
	applyEnvironmentOptions,
	restoreEnvironmentOptions,
	normalizeMetricsOptions,
	selectTopSlowestMetrics,
	createMetricsSummary,
	getComponentName,
	isRenderMetricMessage,
	resolveDomSetupPath,
};
