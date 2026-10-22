import { afterEach, assert, test } from 'poku';
import { useMemo, useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '../src/index.ts';

afterEach(cleanup);

const useToggle = (initialValue = false) => {
  const [enabled, setEnabled] = useState(initialValue);
  const toggle = () => setEnabled((current) => !current);

  return useMemo(() => ({ enabled, toggle }), [enabled]);
};

const HookHarness = () => {
  const { enabled, toggle } = useToggle();

  return (
    <div>
      <output aria-label='toggle-state'>
        {enabled ? 'enabled' : 'disabled'}
      </output>
      <button type='button' onClick={toggle}>
        Toggle
      </button>
    </div>
  );
};

test('tests custom hooks through a component harness', () => {
  render(<HookHarness />);

  assert.strictEqual(
    screen.getByLabelText('toggle-state').textContent,
    'disabled'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
  assert.strictEqual(
    screen.getByLabelText('toggle-state').textContent,
    'enabled'
  );
});

test('tests hook logic directly with renderHook', async () => {
  const { result } = renderHook(
    ({ initial }: { initial: boolean }) => useToggle(initial),
    {
      initialProps: { initial: true },
    }
  );

  assert.strictEqual(result.current.enabled, true);
});

test('renderHook.rerender keeps result.current live after destructuring', async () => {
  const { result, rerender } = renderHook(
    ({ value }: { value: string }) => value,
    {
      initialProps: { value: 'first' },
    }
  );

  assert.strictEqual(result.current, 'first');

  rerender({ value: 'second' });

  assert.strictEqual(result.current, 'second');
});

test('renderHook supports zero-arg hooks and primitive initialProps, plus asFragment/screen.debug', () => {
  const zeroArg = renderHook(() => useToggle());
  assert.strictEqual(zeroArg.result.current.enabled, false);

  const primitiveProp = renderHook((count: number) => count * 2, {
    initialProps: 5,
  });
  assert.strictEqual(primitiveProp.result.current, 10);
  primitiveProp.rerender(7);
  assert.strictEqual(primitiveProp.result.current, 14);

  const view = render(<HookHarness />);
  const fragment = view.asFragment();
  assert.strictEqual(fragment.querySelector('button')?.textContent, 'Toggle');
  assert.strictEqual(typeof screen.debug, 'function');
  assert.strictEqual(typeof view.debug, 'function');
});
