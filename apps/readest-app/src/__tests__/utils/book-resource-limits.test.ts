import { describe, expect, it } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import {
  BOOK_RESOURCE_LIMIT_ERROR_MESSAGE,
  BOOK_RESOURCE_LIMITS,
  ZipResourceValidator,
  assertImageDimensions,
  assertInflatedEntrySize,
  assertMobiDeclarations,
  isBookResourceLimitError,
  preflightZipArchive,
  readRasterImageDimensions,
} from '@/utils/bookResourceLimits';

describe('book resource limits', () => {
  it('recognizes structured native limit errors so bridges can sanitize them', () => {
    expect(
      isBookResourceLimitError({
        message: `internal path omitted: READEST_BOOK_RESOURCE_LIMIT`,
      }),
    ).toBe(true);
  });

  it('rejects a forged entry count before zip.js allocates the directory', async () => {
    const eocd = new Uint8Array(22);
    const view = new DataView(eocd.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(10, BOOK_RESOURCE_LIMITS.zip.maxEntries + 1, true);

    await expect(preflightZipArchive(new Blob([eocd]))).rejects.toThrowError(
      BOOK_RESOURCE_LIMIT_ERROR_MESSAGE,
    );
  });

  it('rejects a forged huge zip entry before extraction', () => {
    const validator = new ZipResourceValidator();
    expect(() =>
      validator.add({
        compressedSize: 16,
        uncompressedSize: BOOK_RESOURCE_LIMITS.zip.maxEntryUncompressedBytes + 1,
      }),
    ).toThrowError(BOOK_RESOURCE_LIMIT_ERROR_MESSAGE);
  });

  it('rejects a small synthetic compression bomb through DocumentLoader', async () => {
    const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');
    const writer = new ZipWriter(new BlobWriter('application/epub+zip'));
    await writer.add('OEBPS/bomb.xhtml', new Uint8ArrayReader(new Uint8Array(2 * 1024 * 1024)), {
      level: 9,
    });
    const blob = await writer.close();
    expect(blob.size).toBeLessThan(32 * 1024);

    const file = new File([await blob.arrayBuffer()], 'bomb.epub', {
      type: 'application/epub+zip',
    });
    await expect(new DocumentLoader(file).open()).rejects.toThrowError(
      BOOK_RESOURCE_LIMIT_ERROR_MESSAGE,
    );
  });

  it('rejects compression-bomb metadata and aggregate expansion', () => {
    expect(() =>
      new ZipResourceValidator().add({
        compressedSize: 1024,
        uncompressedSize: 1024 * (BOOK_RESOURCE_LIMITS.zip.maxCompressionRatio + 1),
      }),
    ).toThrowError(BOOK_RESOURCE_LIMIT_ERROR_MESSAGE);

    const validator = new ZipResourceValidator();
    const entrySize = Math.floor(BOOK_RESOURCE_LIMITS.zip.maxTotalUncompressedBytes / 9);
    for (let index = 0; index < 9; index += 1) {
      validator.add({ compressedSize: entrySize, uncompressedSize: entrySize });
    }
    expect(() =>
      validator.add({ compressedSize: entrySize, uncompressedSize: entrySize }),
    ).toThrowError(BOOK_RESOURCE_LIMIT_ERROR_MESSAGE);
  });

  it('checks actual inflated size after extraction', () => {
    expect(() => assertInflatedEntrySize(1025, 1024)).toThrowError(
      BOOK_RESOURCE_LIMIT_ERROR_MESSAGE,
    );
    expect(() => assertInflatedEntrySize(1024, 1024)).not.toThrow();
  });

  it('rejects an oversized PalmDOC text declaration in a tiny MOBI fixture', async () => {
    const bytes = new Uint8Array(94);
    const view = new DataView(bytes.buffer);
    view.setUint32(78, 82, false); // first PDB record starts at byte 82
    view.setUint32(86, BOOK_RESOURCE_LIMITS.mobi.maxDeclaredTextBytes + 1, false);
    const file = new File([bytes], 'oversized.mobi');

    await expect(assertMobiDeclarations(file)).rejects.toThrowError(
      BOOK_RESOURCE_LIMIT_ERROR_MESSAGE,
    );
  });

  it('rejects oversized raster dimensions from header bytes only', () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, BOOK_RESOURCE_LIMITS.image.maxWidth + 1, false);
    view.setUint32(20, 1, false);

    const dimensions = readRasterImageDimensions(bytes.buffer);
    expect(dimensions).toEqual({ width: BOOK_RESOURCE_LIMITS.image.maxWidth + 1, height: 1 });
    expect(() => assertImageDimensions(dimensions!.width, dimensions!.height)).toThrowError(
      BOOK_RESOURCE_LIMIT_ERROR_MESSAGE,
    );
  });

  it('accepts normal book and cover metadata', async () => {
    const validator = new ZipResourceValidator();
    validator.add({ compressedSize: 5_000, uncompressedSize: 20_000 });
    expect(() => assertImageDimensions(1600, 2400)).not.toThrow();

    const mobi = new Uint8Array(94);
    const view = new DataView(mobi.buffer);
    view.setUint32(78, 82, false);
    view.setUint32(86, 4 * 1024 * 1024, false);
    view.setUint16(90, 1024, false);
    view.setUint16(92, 4096, false);
    await expect(assertMobiDeclarations(new File([mobi], 'normal.mobi'))).resolves.toBeUndefined();
  });
});
