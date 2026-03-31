import { GlobalRegistrator } from '@happy-dom/global-registrator';

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const reactGlobal = globalThis as ReactActGlobal;

const defaultUrl = 'http://localhost:3000/';
const configuredUrl = process.env.POKU_REACT_DOM_URL || defaultUrl;

if (!globalThis.window || !globalThis.document) {
  GlobalRegistrator.register({
    url: configuredUrl,
  });

  // Deno v2 dispatches a native `load` event after module initialization.
  // happy-dom's dispatchEvent rejects events that aren't instances of its
  // own Event class. Intercept and silently drop those to avoid a crash.
  const happyDispatchEvent = globalThis.dispatchEvent;
  globalThis.dispatchEvent = function (event: Event): boolean {
    try {
      return happyDispatchEvent.call(this, event);
    } catch (e) {
      if (e instanceof TypeError && String(e.message).includes('not of type')) {
        return false;
      }
      throw e;
    }
  };
}

if (typeof reactGlobal.IS_REACT_ACT_ENVIRONMENT === 'undefined') {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
}