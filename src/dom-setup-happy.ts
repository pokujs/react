import { GlobalRegistrator } from '@happy-dom/global-registrator';

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const reactGlobal = globalThis as ReactActGlobal;

const defaultUrl = 'http://localhost:3000/';
const configuredUrl = process.env.POKU_REACT_DOM_URL || defaultUrl;

if (!globalThis.window || !globalThis.document) {
  // Deno v2 calls `dispatchLoadEvent` after each module finishes loading.
  // It does: `globalThis.dispatchEvent(new Event("load"))`.
  // happy-dom's GlobalRegistrator replaces both `globalThis.Event` and
  // `globalThis.dispatchEvent` with its own versions, breaking Deno in two
  // ways depending on version:
  //   - older Deno v2: happy-dom's dispatchEvent throws TypeError (wrong Event type)
  //   - newer Deno v2 (≥2.7): happy-dom's dispatchEvent freezes the process
  //   - with only dispatchEvent restored: `new Event("load")` returns a
  //     happy-dom Event that lacks Deno's internal symbol property, causing
  //     "Cannot set properties of undefined (setting 'target')"
  // Fix: snapshot both `Event` and `dispatchEvent` before registration and
  // restore them after. React and @testing-library/dom dispatch events through
  // element.dispatchEvent(), never through globalThis, so nothing is lost.
  const isDenoRuntime = typeof Deno !== 'undefined';
  const nativeEvent = isDenoRuntime ? globalThis.Event : undefined;
  const nativeDispatchEvent = isDenoRuntime
    ? globalThis.dispatchEvent?.bind(globalThis)
    : undefined;

  GlobalRegistrator.register({
    url: configuredUrl,
  });

  if (isDenoRuntime) {
    if (nativeEvent) (globalThis as unknown as Record<string, unknown>).Event = nativeEvent;
    if (nativeDispatchEvent) globalThis.dispatchEvent = nativeDispatchEvent;
  }
}

if (typeof reactGlobal.IS_REACT_ACT_ENVIRONMENT === 'undefined') {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
}