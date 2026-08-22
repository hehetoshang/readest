import { describe, expect, test } from 'vitest';
import {
  enforceBookResourcePolicy,
  getBookContentPolicy,
  normalizeBookContentType,
} from '@/services/bookContentSecurity';

describe('normalizeBookContentType', () => {
  test('removes parameters, surrounding whitespace, and casing differences', () => {
    expect(normalizeBookContentType(' Application/XHTML+XML ; charset=utf-8 ')).toBe(
      'application/xhtml+xml',
    );
  });

  test('normalizes a missing content type to an empty string', () => {
    expect(normalizeBookContentType(undefined)).toBe('');
  });
});

describe('getBookContentPolicy', () => {
  test.each([
    {
      contentType: 'application/xhtml+xml; charset=utf-8',
      resourceName: 'Text/chapter.xhtml',
      expected: { kind: 'document', contentType: 'application/xhtml+xml' },
    },
    {
      contentType: 'Image/SVG+XML',
      resourceName: 'Images/page.svg',
      expected: { kind: 'document', contentType: 'image/svg+xml' },
    },
    {
      contentType: undefined,
      resourceName: 'Text/chapter.xhtml',
      expected: { kind: 'document', contentType: 'application/xhtml+xml' },
    },
    {
      contentType: 'application/x-unknown-document',
      resourceName: 'Text/chapter.xhtml',
      expected: { kind: 'document', contentType: 'application/xhtml+xml' },
    },
    {
      contentType: undefined,
      resourceName: 'resource-without-an-extension',
      expected: { kind: 'reject' },
    },
    {
      contentType: 'application/x-unknown-document',
      resourceName: 'resource-without-an-extension',
      expected: { kind: 'reject' },
    },
    {
      contentType: 'image/png',
      resourceName: 'Images/page.png',
      expected: { kind: 'passthrough' },
    },
  ])('classifies $contentType at $resourceName', (testCase) => {
    expect(getBookContentPolicy(testCase.contentType, testCase.resourceName)).toEqual(
      testCase.expected,
    );
  });
});

describe('enforceBookResourcePolicy', () => {
  test('blocks external JavaScript resources even when the loader initially allows them', () => {
    const detail = { isScript: true, allow: true };

    enforceBookResourcePolicy(detail);

    expect(detail.allow).toBe(false);
  });

  test('does not change non-script resources', () => {
    const detail = { isScript: false, allow: true };

    enforceBookResourcePolicy(detail);

    expect(detail.allow).toBe(true);
  });
});
