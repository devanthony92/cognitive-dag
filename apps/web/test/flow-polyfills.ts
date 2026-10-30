// jsdom has no layout engine; React Flow needs these browser APIs to mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class DOMMatrixReadOnlyStub {
  m22 = 1;
  constructor(transform?: string) {
    const scale = /scale\(([\d.]+)\)/.exec(transform ?? '');
    if (scale?.[1]) this.m22 = Number(scale[1]);
  }
}

globalThis.ResizeObserver = ResizeObserverStub;
(globalThis as Record<string, unknown>)['DOMMatrixReadOnly'] = DOMMatrixReadOnlyStub;

Object.defineProperties(window.HTMLElement.prototype, {
  offsetHeight: { get: () => 40, configurable: true },
  offsetWidth: { get: () => 160, configurable: true },
});
(window.SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox = () => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});
