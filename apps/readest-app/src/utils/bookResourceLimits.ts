import configuredLimits from '@/config/book-resource-limits.json';

/** Stable marker shared with Rust so native limit failures never fall back to an
 * unbounded WebView parser. Do not include file or entry paths in this error. */
export const BOOK_RESOURCE_LIMIT_ERROR_CODE = 'READEST_BOOK_RESOURCE_LIMIT';
export const BOOK_RESOURCE_LIMIT_ERROR_MESSAGE =
  "This book exceeds Readest's safe processing limits. Try a smaller or repaired copy.";

interface BookResourceLimits {
  zip: {
    maxEntries: number;
    maxCentralDirectoryBytes: number;
    maxEntryUncompressedBytes: number;
    maxTotalUncompressedBytes: number;
    maxCompressionRatio: number;
  };
  image: {
    maxInputBytes: number;
    maxWidth: number;
    maxHeight: number;
    maxPixels: number;
    maxDecodedBytes: number;
  };
  mobi: {
    maxFileBytes: number;
    maxDeclaredTextBytes: number;
  };
}

// This JSON file is also embedded by src-tauri/src/parser_limits.rs. It is the
// single source of truth for native and web parsing paths.
export const BOOK_RESOURCE_LIMITS = configuredLimits satisfies BookResourceLimits;

export class BookResourceLimitError extends Error {
  readonly code = BOOK_RESOURCE_LIMIT_ERROR_CODE;

  constructor() {
    super(BOOK_RESOURCE_LIMIT_ERROR_MESSAGE);
    this.name = 'BookResourceLimitError';
  }
}

const errorText = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return `${String(value['code'] ?? '')}: ${String(value['message'] ?? value['error'] ?? '')}`;
  }
  return String(error);
};

export const isBookResourceLimitError = (error: unknown): boolean =>
  error instanceof BookResourceLimitError ||
  errorText(error).includes(BOOK_RESOURCE_LIMIT_ERROR_CODE) ||
  errorText(error).includes(BOOK_RESOURCE_LIMIT_ERROR_MESSAGE);

const reject = (): never => {
  throw new BookResourceLimitError();
};

export interface ZipEntryResourceMetadata {
  compressedSize: number;
  uncompressedSize: number;
  directory?: boolean;
}

const isSafeSize = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Read only the ZIP end records first, bounding the central directory before
 * zip.js materializes it. ZIP64 keeps its locator immediately before EOCD. */
export const preflightZipArchive = async (file: Blob): Promise<void> => {
  const eocdLength = 22;
  const zip64LocatorLength = 20;
  const tailLength = Math.min(file.size, 65_535 + eocdLength + zip64LocatorLength);
  if (tailLength < eocdLength) return;
  const tailOffset = file.size - tailLength;
  const tail = await file.slice(tailOffset).arrayBuffer();
  const bytes = new Uint8Array(tail);
  let eocd = -1;
  for (let offset = bytes.length - eocdLength; offset >= 0; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      const commentLength = bytes[offset + 20]! | (bytes[offset + 21]! << 8);
      if (offset + eocdLength + commentLength === bytes.length) {
        eocd = offset;
        break;
      }
    }
  }
  if (eocd < 0) return; // zip.js reports the normal corruption error.

  const view = new DataView(tail);
  const entries = view.getUint16(eocd + 10, true);
  const directoryBytes = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const eocdAbsolute = tailOffset + eocd;
  const actualDirectoryBytes =
    directoryOffset <= eocdAbsolute ? eocdAbsolute - directoryOffset : Number.POSITIVE_INFINITY;
  const needsZip64 =
    entries === 0xffff || directoryBytes === 0xffffffff || directoryOffset === 0xffffffff;
  if (!needsZip64) {
    if (
      entries > BOOK_RESOURCE_LIMITS.zip.maxEntries ||
      directoryBytes > BOOK_RESOURCE_LIMITS.zip.maxCentralDirectoryBytes ||
      actualDirectoryBytes > BOOK_RESOURCE_LIMITS.zip.maxCentralDirectoryBytes
    ) {
      reject();
    }
    return;
  }

  const locator = eocd - 20;
  if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) {
    throw new Error('The book archive is corrupted.');
  }
  const zip64Offset = view.getBigUint64(locator + 8, true);
  if (zip64Offset > BigInt(Number.MAX_SAFE_INTEGER)) reject();
  const zip64Header = await file.slice(Number(zip64Offset), Number(zip64Offset) + 56).arrayBuffer();
  if (zip64Header.byteLength < 56) throw new Error('The book archive is corrupted.');
  const zip64 = new DataView(zip64Header);
  if (zip64.getUint32(0, true) !== 0x06064b50) {
    throw new Error('The book archive is corrupted.');
  }
  const zip64Entries = zip64.getBigUint64(32, true);
  const zip64DirectoryBytes = zip64.getBigUint64(40, true);
  const zip64DirectoryOffset = zip64.getBigUint64(48, true);
  const zip64ActualDirectoryBytes =
    zip64DirectoryOffset <= zip64Offset
      ? zip64Offset - zip64DirectoryOffset
      : BigInt(Number.MAX_SAFE_INTEGER);
  if (
    zip64Entries > BigInt(BOOK_RESOURCE_LIMITS.zip.maxEntries) ||
    zip64DirectoryBytes > BigInt(BOOK_RESOURCE_LIMITS.zip.maxCentralDirectoryBytes) ||
    zip64ActualDirectoryBytes > BigInt(BOOK_RESOURCE_LIMITS.zip.maxCentralDirectoryBytes)
  ) {
    reject();
  }
};

/** Incremental central-directory validator. `DocumentLoader` feeds entries to
 * this while zip.js generates them, so entry-count/size failures stop before a
 * complete array of attacker-controlled entries is retained. */
export class ZipResourceValidator {
  private count = 0;
  private total = 0;

  add(entry: ZipEntryResourceMetadata): void {
    const limits = BOOK_RESOURCE_LIMITS.zip;
    this.count += 1;
    if (this.count > limits.maxEntries) reject();
    if (entry.directory) return;

    const { compressedSize, uncompressedSize } = entry;
    if (!isSafeSize(compressedSize) || !isSafeSize(uncompressedSize)) reject();
    if (uncompressedSize > limits.maxEntryUncompressedBytes) reject();
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 || uncompressedSize > compressedSize * limits.maxCompressionRatio)
    ) {
      reject();
    }

    this.total += uncompressedSize;
    if (!Number.isSafeInteger(this.total) || this.total > limits.maxTotalUncompressedBytes) {
      reject();
    }
  }
}

/** Re-check the bytes produced by the inflater. zip.js also compares this with
 * the central-directory declaration; this explicit gate protects custom
 * writers and keeps the post-read invariant visible in Readest code. */
export const assertInflatedEntrySize = (actual: number, declared: number): void => {
  if (
    !isSafeSize(actual) ||
    actual > BOOK_RESOURCE_LIMITS.zip.maxEntryUncompressedBytes ||
    actual !== declared
  ) {
    reject();
  }
};

export const assertMobiFileSize = (size: number): void => {
  if (!isSafeSize(size) || size > BOOK_RESOURCE_LIMITS.mobi.maxFileBytes) reject();
};

/** Validate the small PDB/PalmDOC declaration before MOBI parsing can walk or
 * inflate records. Truncated headers are left to the normal corruption path. */
export const assertMobiDeclarations = async (file: Blob): Promise<void> => {
  assertMobiFileSize(file.size);
  if (file.size < 90) return;

  const pdbHeader = new DataView(await file.slice(0, 82).arrayBuffer());
  const recordZeroOffset = pdbHeader.getUint32(78, false);
  if (recordZeroOffset > file.size - 12) return;

  const palmDoc = new DataView(
    await file.slice(recordZeroOffset + 4, recordZeroOffset + 12).arrayBuffer(),
  );
  if (palmDoc.byteLength < 8) return;
  const declaredTextBytes = palmDoc.getUint32(0, false);
  const textRecordCount = palmDoc.getUint16(4, false);
  const textRecordSize = palmDoc.getUint16(6, false);
  const maximumRecordText = textRecordCount * textRecordSize;
  if (
    declaredTextBytes > BOOK_RESOURCE_LIMITS.mobi.maxDeclaredTextBytes ||
    maximumRecordText > BOOK_RESOURCE_LIMITS.mobi.maxDeclaredTextBytes
  ) {
    reject();
  }
};

export const assertImageInputSize = (size: number): void => {
  if (!isSafeSize(size) || size > BOOK_RESOURCE_LIMITS.image.maxInputBytes) reject();
};

export const assertImageDimensions = (width: number, height: number): void => {
  const limits = BOOK_RESOURCE_LIMITS.image;
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > limits.maxWidth ||
    height > limits.maxHeight ||
    !Number.isSafeInteger(pixels) ||
    pixels > limits.maxPixels ||
    pixels * 4 > limits.maxDecodedBytes
  ) {
    reject();
  }
};

export interface ImageDimensions {
  width: number;
  height: number;
}

const u24le = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);

/** Header-only dimension probe for cover-preview paths. Unknown formats return
 * null and are not decoded; avoiding a best-effort decode is safer for bytes
 * received from books or peers. */
export const readRasterImageDimensions = (buffer: ArrayBuffer): ImageDimensions | null => {
  const bytes = new Uint8Array(buffer);
  assertImageInputSize(bytes.byteLength);

  // PNG: signature + IHDR width/height.
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(buffer);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }

  // GIF logical screen descriptor.
  if (bytes.length >= 10 && String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF') {
    const view = new DataView(buffer);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // BMP DIB headers (legacy CORE uses u16, modern INFO variants use i32).
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const view = new DataView(buffer);
    const dibSize = view.getUint32(14, true);
    if (dibSize === 12) {
      return { width: view.getUint16(18, true), height: view.getUint16(20, true) };
    }
    if (dibSize >= 40) {
      return {
        width: Math.abs(view.getInt32(18, true)),
        height: Math.abs(view.getInt32(22, true)),
      };
    }
  }

  // WebP extended/lossless headers. The optional preview path safely skips
  // legacy VP8 headers rather than implementing a permissive bitstream parser.
  if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === 'VP8X') {
      return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }

  // JPEG SOF marker scan. Segment lengths are checked before every read.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++]!;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 1 >= bytes.length) break;
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (length < 2 || offset + length > bytes.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && length >= 7) {
        return {
          height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
          width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        };
      }
      offset += length;
    }
  }

  return null;
};
