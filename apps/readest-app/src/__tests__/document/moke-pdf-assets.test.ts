import { afterEach, describe, expect, it } from 'vitest';
import { pdfjsPath } from 'foliate-js/pdf-assets.js';

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__MOKE_EMBEDDED');
});

describe('Moke PDF assets', () => {
  it('uses Readest-owned PDF assets when embedded', () => {
    Reflect.set(globalThis, '__MOKE_EMBEDDED', true);

    expect(pdfjsPath('jbig2.wasm')).toBe('/readest/vendor/pdfjs/jbig2.wasm');
  });

  it('keeps standalone Readest at the origin root', () => {
    expect(pdfjsPath('pdf.worker.min.mjs')).toBe('/vendor/pdfjs/pdf.worker.min.mjs');
  });
});
