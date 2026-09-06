// Shared helpers for the native import fast-path.
//
// Both the EPUB parser (`epub_parser`) and the MOBI/AZW/AZW3 parser
// (`mobi_parser`) need to:
//   - compute the same `partialMD5` over the input file as `utils/md5.ts`,
//     so the on-disk `Books/<hash>/...` layout stays stable regardless of
//     which parser produced the entry,
//   - clamp oversized cover artwork to the library-grid thumbnail size,
//     re-encoding as JPEG q85 when downscaling actually fires.
//
// Keeping these in a single module avoids drift between the two import
// paths (a divergent partialMD5 implementation would silently re-import
// every existing book under a new hash on the first run after a change).
//
// `RawCoverImage` is the IPC-shaped struct returned to JS as a byte array
// + MIME pair; the JS bridges (`tauriEpubBridge.ts`, `tauriMobiBridge.ts`)
// turn it back into a `Uint8Array` before persisting through the existing
// `Books/<hash>/cover.<ext>` path.

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, GenericImageView, ImageReader};
use md5::{Digest, Md5};
use serde::Serialize;
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use crate::parser_limits::{
    image_decoder_limits, is_resource_limit_error, resource_limit_error, validate_image_dimensions,
    validate_image_input_size,
};

/// Cover thumbnail target. Sized for the library grid (~250-300px @2x)
/// and the reader-sidebar / detail-view rows (which are smaller still).
/// Anything whose long edge is already at or below this stays untouched —
/// no decode/re-encode, original bytes are kept verbatim. Anything larger
/// is downscaled with [`COVER_RESIZE_FILTER`] and re-encoded as JPEG q85.
pub const COVER_MAX_LONG_EDGE: u32 = 512;
pub const COVER_JPEG_QUALITY: u8 = 85;

/// Resampling filter used to downscale covers. We deliberately use
/// `Triangle` (4-tap bilinear-ish) instead of `Lanczos3` (36-tap): at the
/// 512px-thumbnail scale the visual difference is imperceptible, but
/// Triangle is ~5-8x faster on a debug build (and ~3-5x faster on release)
/// because it touches far fewer source pixels per output pixel. Cover
/// thumbnails are displayed at <=300px in the UI, so any sharpening
/// advantage Lanczos3 would have is moot.
pub const COVER_RESIZE_FILTER: FilterType = FilterType::Triangle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCoverImage {
    /// Raw image bytes (serde will encode this as a JS array; the JS side
    /// converts it back to a Uint8Array before writing to disk).
    pub bytes: Vec<u8>,
    pub mime: String,
}

/// Decode untrusted image bytes under the shared strict dimension and bounded
/// allocation policy. Dimensions are probed first and validated again after
/// decode, so a decoder cannot make a large allocation from a forged header
/// before Readest notices it.
pub fn decode_image_with_limits(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    validate_image_input_size(bytes.len())?;

    let make_reader = || {
        ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|error| format!("decode failed: {error}"))
    };

    let mut dimensions_reader = make_reader()?;
    dimensions_reader.limits(image_decoder_limits());
    let (width, height) = dimensions_reader.into_dimensions().map_err(|error| {
        if matches!(&error, image::ImageError::Limits(_)) {
            resource_limit_error()
        } else {
            format!("decode failed: {error}")
        }
    })?;
    validate_image_dimensions(width, height)?;

    let mut decode_reader = make_reader()?;
    decode_reader.limits(image_decoder_limits());
    let image = decode_reader.decode().map_err(|error| {
        if matches!(&error, image::ImageError::Limits(_)) {
            resource_limit_error()
        } else {
            format!("decode failed: {error}")
        }
    })?;
    let (decoded_width, decoded_height) = image.dimensions();
    validate_image_dimensions(decoded_width, decoded_height)?;
    Ok(image)
}

/// Decode `bytes`, and if the long edge exceeds [`COVER_MAX_LONG_EDGE`],
/// resize ([`COVER_RESIZE_FILTER`], aspect ratio preserved) and re-encode
/// as JPEG at [`COVER_JPEG_QUALITY`].
///
/// Ordinary format/decode errors retain the previous best-effort behavior and
/// return the original bytes. Resource-limit errors are different: propagating
/// them prevents a malicious cover from reaching another, unbounded decoder.
pub fn maybe_resize_cover(bytes: Vec<u8>, hint_mime: &str) -> Result<(Vec<u8>, String), String> {
    let img = match decode_image_with_limits(&bytes) {
        Ok(image) => image,
        Err(error) if is_resource_limit_error(&error) => return Err(error),
        Err(_) => return Ok((bytes, hint_mime.to_string())),
    };
    let (w, h) = img.dimensions();
    if w.max(h) <= COVER_MAX_LONG_EDGE {
        return Ok((bytes, hint_mime.to_string()));
    }
    let resized = img.resize(
        COVER_MAX_LONG_EDGE,
        COVER_MAX_LONG_EDGE,
        COVER_RESIZE_FILTER,
    );
    let rgb = resized.to_rgb8();

    let mut out = Vec::with_capacity(64 * 1024);
    {
        let mut encoder = JpegEncoder::new_with_quality(Cursor::new(&mut out), COVER_JPEG_QUALITY);
        if encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .is_err()
        {
            return Ok((bytes, hint_mime.to_string()));
        }
    }
    Ok((out, "image/jpeg".to_string()))
}

/// Mirror of `utils/md5.ts::partialMD5`:
///
/// ```ts
///   step = 1024, size = 1024
///   for i in -1..=10:
///     start = min(file.size, step << (2*i))   // JS 32-bit shift
///     end   = min(start + size, file.size)
///     if start >= file.size: break
///     hash file[start..end]
/// ```
///
/// JS bit-shift operands are masked to their low 5 bits, so `1024 << -2`
/// actually means `1024 << 30`, which is far larger than any reasonable
/// file. That makes the very first iteration (`i = -1`) immediately break
/// for files smaller than ~1 `GiB`, leaving the hasher empty -> md5 of "" =
/// d41d8cd9... We must reproduce that behaviour bit-for-bit so existing
/// on-disk hashes (`Books/<hash>/...`) keep matching.
pub fn compute_partial_md5(path: &Path) -> std::io::Result<String> {
    const STEP: u32 = 1024;
    const CHUNK: u64 = 1024;

    let mut file = File::open(path)?;
    let file_len = file.metadata()?.len();

    let mut hasher = Md5::new();
    let mut buf = vec![0u8; CHUNK as usize];

    for i in -1i32..=10 {
        // JS evaluates `step << (2*i)` as a 32-bit shift, where the operand is
        // implicitly masked to its low 5 bits. So `1024 << -2` is the same as
        // `1024 << 30`, which overflows i32 to 0 (the high bits are dropped).
        // For i = 0..=4 the shift is 0..=8 and stays within i32; for i >= 5
        // the result overflows to 0 again. We mirror that with wrapping_shl.
        let shift_amount = ((2 * i) as u32) & 31;
        let shifted = (STEP as i32).wrapping_shl(shift_amount);
        // Negative i32 results coerce to 0 here. JS's Math.min would surface
        // the negative value, but the subsequent `start >= file.size` check
        // would skip the read; clamping to 0 gives the same observable
        // hash for non-empty files while avoiding negative seek offsets.
        let raw = shifted.max(0) as u64;
        let start = std::cmp::min(file_len, raw);
        if start >= file_len {
            break;
        }
        let end = std::cmp::min(start + CHUNK, file_len);
        let to_read = (end - start) as usize;
        file.seek(SeekFrom::Start(start))?;
        let slice = &mut buf[..to_read];
        file.read_exact(slice)?;
        hasher.update(&slice[..]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}
