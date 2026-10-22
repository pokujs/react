import type {
  fireEvent as baseFireEvent,
  BoundFunctions,
  PrettyDOMOptions,
  Screen,
} from '@testing-library/dom';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { createRequire } from 'node:module';
import {
  configureDomTestingLibrary,
  createAsFragment,
  createDebug,
  createRenderMetricsEmitter,
  createScopedRegistry,
  createScreen,
  createWaitFor,
  getNow,
  wrapFireEventMethods,
} from '@pokujs/dom';
import {
  configure as configureTestingLibrary,
  getQueriesForElement,
  queries,
} from '@testing-library/dom';
import * as domTestingLibrary from '@testing-library/dom';
import React from 'react';
import { parseRuntimeOptions } from './runtime-options.ts';

// Lazily load `react-dom/client` on first `render()` call rather than at module
// import time. If a user imports `reactTestingPlugin` from the `@pokujs/react`
// barrel inside `poku.config.js` under `isolation: 'none'`, the config module is
// evaluated before `plugin.setup()` installs `window` and `document`. Eagerly
// importing `react-dom/client` before `window` exists causes React DOM to cache
// `canUseDOM = false` and permanently disable its synthetic event system.
let cachedCreateRoot: typeof import('react-dom/client').createRoot | undefined;
const getCreateRoot = (): typeof import('react-dom/client').createRoot => {
  if (!cachedCreateRoot) {
    const req = createRequire(import.meta.url);
    const reactDomClient = req(
      'react-dom/client'
    ) as typeof import('react-dom/client');
    cachedCreateRoot = reactDomClient.createRoot;
  }
  return cachedCreateRoot;
};

const { act } = React;

export { act };

// Wire @testing-library/dom's asyncWrapper and eventWrapper to React's act()
// so that waitFor(), findBy*(), and fireEvent work without React act() warnings.
const testingLibraryConfig = {
  asyncWrapper: async (cb: () => Promise<unknown>) => {
    const reactGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean | undefined;
    };
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const result = await cb();
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 0);
      });
      return result;
    } finally {
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  },
  eventWrapper: (cb: () => unknown) => {
    let result: unknown;
    act(() => {
      result = cb();
    });
    return result;
  },
};

configureTestingLibrary(testingLibraryConfig);
configureDomTestingLibrary(testingLibraryConfig);

type WrapperComponent = ComponentType<{ children: ReactNode }>;

type InternalMounted = {
  root: Root | null;
  container: Element | null;
  ownsContainer: boolean;
};

const unmountMounted = (
  mountedRoots: Set<InternalMounted>,
  mounted: InternalMounted
) => {
  try {
    act(() => {
      mounted.root?.unmount();
    });
  } finally {
    if (mounted.ownsContainer && mounted.container?.parentNode) {
      mounted.container.parentNode.removeChild(mounted.container);
    }

    mounted.root = null;
    mounted.container = null;
    mountedRoots.delete(mounted);
  }
};

const cleanupMountedRoots = (mountedRoots: Set<InternalMounted>) => {
  for (const mounted of [...mountedRoots]) {
    unmountMounted(mountedRoots, mounted);
  }
};

const metrics = createRenderMetricsEmitter({
  runtimeOptions: () => parseRuntimeOptions(),
  metricsStateKey: Symbol.for('@pokujs/react.metrics-runtime-state'),
  metricsBatchMessageType: 'POKU_REACT_RENDER_METRIC_BATCH',
});

const registry = createScopedRegistry<InternalMounted>({
  name: '@pokujs/react.mounted-roots',
  onCleanup: (mountedRoots) => {
    cleanupMountedRoots(mountedRoots);
    metrics.flushMetricBuffer();
  },
});

const getComponentName = (ui: ReactElement) => {
  const uiType = ui.type;
  if (!uiType) return 'AnonymousComponent';
  if (typeof uiType === 'string') return uiType;

  const typed = uiType as { displayName?: string; name?: string };
  return typed.displayName || typed.name || 'AnonymousComponent';
};

const wrapUi = (ui: ReactElement, Wrapper?: WrapperComponent) =>
  Wrapper ? React.createElement(Wrapper, null, ui) : ui;

export type RenderOptions = {
  container?: HTMLElement;
  baseElement?: HTMLElement;
  wrapper?: WrapperComponent;
  disableAct?: boolean;
};

export type RenderResult = BoundFunctions<typeof queries> & {
  container: HTMLElement;
  baseElement: HTMLElement;
  rerender: (ui: ReactElement) => void;
  unmount: () => void;
  asFragment: () => DocumentFragment;
  debug: (
    element?: Array<Element | HTMLDocument> | Element | HTMLDocument,
    maxLength?: number,
    options?: PrettyDOMOptions
  ) => void;
};

export const render = (
  ui: ReactElement,
  options: RenderOptions = {}
): RenderResult => {
  const mountedRoots = registry.getItems();
  const baseElement = options.baseElement || options.container || document.body;
  const container = options.container || document.createElement('div');
  const ownsContainer = !options.container;

  if (ownsContainer) baseElement.appendChild(container);

  const root = getCreateRoot()(container);
  const mounted: InternalMounted = { root, container, ownsContainer };
  mountedRoots.add(mounted);

  const wrappedUi = wrapUi(ui, options.wrapper);
  const startedAt = getNow();

  if (options.disableAct) {
    root.render(wrappedUi);
  } else {
    act(() => {
      root.render(wrappedUi);
    });
  }

  metrics.emitRenderMetric(getComponentName(ui), getNow() - startedAt);

  const unmount = () => {
    if (!mountedRoots.has(mounted)) return;
    unmountMounted(mountedRoots, mounted);
  };

  const rerender = (nextUi: ReactElement) => {
    if (options.disableAct) {
      root.render(wrapUi(nextUi, options.wrapper));
      return;
    }

    act(() => {
      root.render(wrapUi(nextUi, options.wrapper));
    });
  };

  return {
    ...getQueriesForElement(baseElement),
    container,
    baseElement,
    rerender,
    unmount,
    asFragment: createAsFragment(container),
    debug: createDebug(baseElement),
  };
};

export type RenderHookOptions<Props = unknown> = RenderOptions & {
  initialProps?: Props;
};

export type RenderHookResult<Result, Props = unknown> = {
  readonly result: {
    readonly current: Result;
  };
  rerender: (nextProps?: Props) => void;
  unmount: () => void;
};

export const renderHook = <Result, Props = unknown>(
  hook: (initialProps: Props) => Result,
  options: RenderHookOptions<Props> = {}
): RenderHookResult<Result, Props> => {
  let currentResult!: Result;
  let currentProps = options.initialProps as Props;

  const HookHarness = () => {
    currentResult = hook(currentProps);
    return null;
  };

  const view = render(React.createElement(HookHarness), options);

  const resultRef: { current: Result } = {
    get current() {
      return currentResult;
    },
  } as { current: Result };

  return {
    get result() {
      return resultRef;
    },
    rerender(nextProps = currentProps) {
      currentProps = nextProps;
      view.rerender(React.createElement(HookHarness));
    },
    unmount: view.unmount,
  };
};

export const cleanup = () => {
  const scopedMountedRoots = registry.getScopedItems();
  if (scopedMountedRoots) cleanupMountedRoots(scopedMountedRoots);

  cleanupMountedRoots(registry.fallbackItems);

  metrics.flushMetricBuffer();
};

export const screen = createScreen() as Screen;

const baseFireEventInstance = domTestingLibrary.fireEvent;

const wrappedFireEvent = ((...args: Parameters<typeof baseFireEvent>) => {
  let result!: ReturnType<typeof baseFireEvent>;
  act(() => {
    result = baseFireEventInstance(...args);
  });
  return result;
}) as typeof baseFireEvent;

wrapFireEventMethods(
  wrappedFireEvent as unknown as Record<string, unknown>,
  baseFireEventInstance as unknown as Record<string, unknown>,
  (invoke: () => unknown) => {
    let result: unknown;
    act(() => {
      result = invoke();
    });
    return result;
  }
);

export const fireEvent = wrappedFireEvent;
export const waitFor = createWaitFor(domTestingLibrary.waitFor);

export * from '@testing-library/dom';
