import { describe, expect, it } from 'vitest';

import { PickerLifecycle } from '../../frontend/src/explorer/picker-lifecycle';

function layerHarness() {
  let removals = 0;
  return {
    layer: { remove: () => { removals += 1; } },
    get removals() { return removals; },
  };
}

describe('PickerLifecycle', () => {
  it('removes and disposes the previous picker before activating another', () => {
    const lifecycle = new PickerLifecycle();
    const first = layerHarness();
    const second = layerHarness();
    let disposals = 0;

    lifecycle.activate(first.layer);
    lifecycle.attach(first.layer, () => { disposals += 1; });
    lifecycle.activate(second.layer);

    expect(first.removals).toBe(1);
    expect(disposals).toBe(1);
    expect(second.removals).toBe(0);
  });

  it('immediately disposes a late render result from a replaced picker', () => {
    const lifecycle = new PickerLifecycle();
    const first = layerHarness();
    const second = layerHarness();
    let staleDisposals = 0;

    lifecycle.activate(first.layer);
    lifecycle.activate(second.layer);
    lifecycle.attach(first.layer, () => { staleDisposals += 1; });

    expect(staleDisposals).toBe(1);
    expect(second.removals).toBe(0);
  });
});
