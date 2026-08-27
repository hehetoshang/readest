//! Central resource gates for untrusted ebook parsing.
//!
//! The canonical defaults live in `src/config/book-resource-limits.json`, which
//! is imported by the WebView too. Keeping one data file prevents the native
//! EPUB/MOBI fast paths from silently accepting inputs that the JS fallback
//! rejects (or vice versa).

use serde::Deserialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::OnceLock;
use zip::ZipArchive;

pub const RESOURCE_LIMIT_ERROR_CODE: &str = "READEST_BOOK_RESOURCE_LIMIT";
pub const RESOURCE_LIMIT_ERROR_MESSAGE: &str =
    "This book exceeds Readest's safe processing limits. Try a smaller or repaired copy.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipLimits {
    pub max_entries: usize,
    pub max_central_directory_bytes: u64,
    pub max_entry_uncompressed_bytes: u64,
    pub max_total_uncompressed_bytes: u64,
    pub max_compression_ratio: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageLimits {
    pub max_input_bytes: u64,
    pub max_width: u32,
    pub max_height: u32,
    pub max_pixels: u64,
    pub max_decoded_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobiLimits {
    pub max_file_bytes: u64,
    pub max_declared_text_bytes: u64,
}

#[derive(Debug, Deserialize)]
pub struct ParserLimits {
    pub zip: ZipLimits,
    pub image: ImageLimits,
    pub mobi: MobiLimits,
}

static LIMITS: OnceLock<ParserLimits> = OnceLock::new();

pub fn limits() -> &'static ParserLimits {
    LIMITS.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/config/book-resource-limits.json"))
            .expect("book resource limits config must be valid")
    })
}

pub fn resource_limit_error() -> String {
    format!("{RESOURCE_LIMIT_ERROR_CODE}: {RESOURCE_LIMIT_ERROR_MESSAGE}")
}

pub fn is_resource_limit_error(error: &str) -> bool {
    error.contains(RESOURCE_LIMIT_ERROR_CODE)
}

fn reject_if(condition: bool) -> Result<(), String> {
    if condition {
        Err(resource_limit_error())
    } else {
        Ok(())
    }
}

pub fn validate_zip_file(path: &Path) -> Result<(), String> {
    const EOCD_LENGTH: usize = 22;
    const ZIP64_LOCATOR_LENGTH: u64 = 20;
    const MAX_TAIL: u64 = 65_535 + EOCD_LENGTH as u64 + ZIP64_LOCATOR_LENGTH;

    let mut file = File::open(path).map_err(|_| "The book file could not be read.".to_string())?;
    let file_size = file
        .metadata()
        .map_err(|_| "The book file could not be read.".to_string())?
        .len();
    if file_size < EOCD_LENGTH as u64 {
        return Ok(());
    }
    let tail_size = file_size.min(MAX_TAIL) as usize;
    file.seek(SeekFrom::End(-(tail_size as i64)))
        .map_err(|_| "The book archive is corrupted.".to_string())?;
    let mut tail = vec![0u8; tail_size];
    file.read_exact(&mut tail)
        .map_err(|_| "The book archive is corrupted.".to_string())?;
    let eocd = (0..=tail.len() - EOCD_LENGTH).rev().find(|offset| {
        if tail[*offset..*offset + 4] != [0x50, 0x4b, 0x05, 0x06] {
            return false;
        }
        let comment_length = u16::from_le_bytes([tail[*offset + 20], tail[*offset + 21]]) as usize;
        *offset + EOCD_LENGTH + comment_length == tail.len()
    });
    let Some(eocd) = eocd else {
        return Ok(());
    };

    let entries = u16::from_le_bytes([tail[eocd + 10], tail[eocd + 11]]);
    let directory_size = u32::from_le_bytes([
        tail[eocd + 12],
        tail[eocd + 13],
        tail[eocd + 14],
        tail[eocd + 15],
    ]);
    let directory_offset = u32::from_le_bytes([
        tail[eocd + 16],
        tail[eocd + 17],
        tail[eocd + 18],
        tail[eocd + 19],
    ]);
    let configured = &limits().zip;
    let eocd_absolute = file_size - tail_size as u64 + eocd as u64;
    let actual_directory_size = eocd_absolute
        .checked_sub(directory_offset as u64)
        .unwrap_or(u64::MAX);
    let needs_zip64 =
        entries == u16::MAX || directory_size == u32::MAX || directory_offset == u32::MAX;
    if !needs_zip64 {
        reject_if(entries as usize > configured.max_entries)?;
        reject_if(directory_size as u64 > configured.max_central_directory_bytes)?;
        return reject_if(actual_directory_size > configured.max_central_directory_bytes);
    }

    if eocd_absolute < ZIP64_LOCATOR_LENGTH {
        return Ok(());
    }
    file.seek(SeekFrom::Start(eocd_absolute - ZIP64_LOCATOR_LENGTH))
        .map_err(|_| "The book archive is corrupted.".to_string())?;
    let mut locator = [0u8; ZIP64_LOCATOR_LENGTH as usize];
    file.read_exact(&mut locator)
        .map_err(|_| "The book archive is corrupted.".to_string())?;
    if locator[..4] != [0x50, 0x4b, 0x06, 0x07] {
        return Err("The book archive is corrupted.".to_string());
    }
    let zip64_offset = u64::from_le_bytes(locator[8..16].try_into().unwrap());
    if zip64_offset > file_size.saturating_sub(56) {
        return Err("The book archive is corrupted.".to_string());
    }
    file.seek(SeekFrom::Start(zip64_offset))
        .map_err(|_| "The book archive is corrupted.".to_string())?;
    let mut zip64 = [0u8; 56];
    file.read_exact(&mut zip64)
        .map_err(|_| "The book archive is corrupted.".to_string())?;
    if zip64[..4] != [0x50, 0x4b, 0x06, 0x06] {
        return Err("The book archive is corrupted.".to_string());
    }
    let entries = u64::from_le_bytes(zip64[32..40].try_into().unwrap());
    let directory_size = u64::from_le_bytes(zip64[40..48].try_into().unwrap());
    let directory_offset = u64::from_le_bytes(zip64[48..56].try_into().unwrap());
    let actual_directory_size = zip64_offset
        .checked_sub(directory_offset)
        .unwrap_or(u64::MAX);
    reject_if(entries > configured.max_entries as u64)?;
    reject_if(directory_size > configured.max_central_directory_bytes)?;
    reject_if(actual_directory_size > configured.max_central_directory_bytes)
}

pub fn validate_zip_entry_metadata(compressed: u64, uncompressed: u64) -> Result<(), String> {
    let limits = &limits().zip;
    reject_if(uncompressed > limits.max_entry_uncompressed_bytes)?;
    reject_if(
        uncompressed > 0
            && (compressed == 0
                || uncompressed > compressed.saturating_mul(limits.max_compression_ratio)),
    )
}

pub fn validate_zip_archive<R: std::io::Read + std::io::Seek>(
    zip: &mut ZipArchive<R>,
) -> Result<(), String> {
    let limits = &limits().zip;
    reject_if(zip.len() > limits.max_entries)?;

    let mut total = 0u64;
    for index in 0..zip.len() {
        let entry = zip
            .by_index_raw(index)
            .map_err(|_| "The book archive is corrupted.".to_string())?;
        if entry.is_dir() {
            continue;
        }
        validate_zip_entry_metadata(entry.compressed_size(), entry.size())?;
        total = total.saturating_add(entry.size());
        reject_if(total > limits.max_total_uncompressed_bytes)?;
    }
    Ok(())
}

pub fn validate_image_input_size(size: usize) -> Result<(), String> {
    validate_image_input_size_u64(size as u64)
}

pub fn validate_image_input_size_u64(size: u64) -> Result<(), String> {
    reject_if(size > limits().image.max_input_bytes)
}

pub fn validate_image_dimensions(width: u32, height: u32) -> Result<(), String> {
    let limits = &limits().image;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    let rgba_bytes = pixels.saturating_mul(4);
    reject_if(
        width == 0
            || height == 0
            || width > limits.max_width
            || height > limits.max_height
            || pixels > limits.max_pixels
            || rgba_bytes > limits.max_decoded_bytes,
    )
}

pub fn image_decoder_limits() -> image::Limits {
    let configured = &limits().image;
    let mut decoder_limits = image::Limits::default();
    decoder_limits.max_image_width = Some(configured.max_width);
    decoder_limits.max_image_height = Some(configured.max_height);
    decoder_limits.max_alloc = Some(configured.max_decoded_bytes);
    decoder_limits
}

pub fn validate_mobi_file(path: &Path) -> Result<(), String> {
    let size = path
        .metadata()
        .map_err(|_| "The book file could not be read.".to_string())?
        .len();
    reject_if(size > limits().mobi.max_file_bytes)?;

    // PalmDB header (78 bytes) + first record offset (4 bytes). Tiny/truncated
    // files are handled by the normal parser error path without allocation.
    if size < 90 {
        return Ok(());
    }
    let mut file = File::open(path).map_err(|_| "The book file could not be read.".to_string())?;
    let mut header = [0u8; 82];
    file.read_exact(&mut header)
        .map_err(|_| "The book file is corrupted.".to_string())?;
    let record_zero = u32::from_be_bytes([header[78], header[79], header[80], header[81]]) as u64;
    if record_zero > size.saturating_sub(12) {
        return Err("The book file is corrupted.".to_string());
    }

    // PalmDOC: text_length at +4, text record count at +8, record size at +10.
    file.seek(SeekFrom::Start(record_zero + 4))
        .map_err(|_| "The book file is corrupted.".to_string())?;
    let mut declaration = [0u8; 8];
    file.read_exact(&mut declaration)
        .map_err(|_| "The book file is corrupted.".to_string())?;
    let declared_text = u32::from_be_bytes([
        declaration[0],
        declaration[1],
        declaration[2],
        declaration[3],
    ]) as u64;
    let text_records = u16::from_be_bytes([declaration[4], declaration[5]]) as u64;
    let record_size = u16::from_be_bytes([declaration[6], declaration[7]]) as u64;
    validate_mobi_declared_text_size(declared_text)?;
    validate_mobi_declared_text_size(text_records.saturating_mul(record_size))
}

pub fn validate_mobi_declared_text_size(size: u64) -> Result<(), String> {
    reject_if(size > limits().mobi.max_declared_text_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn zip_with_entry(contents: &[u8], compression: zip::CompressionMethod) -> Vec<u8> {
        let mut output = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut output));
            let options = zip::write::SimpleFileOptions::default().compression_method(compression);
            writer.start_file("content.xhtml", options).unwrap();
            writer.write_all(contents).unwrap();
            writer.finish().unwrap();
        }
        output
    }

    #[test]
    fn shared_config_has_conservative_ordered_limits() {
        let limits = limits();
        assert!(limits.zip.max_entries >= 1_000);
        assert!(limits.zip.max_entry_uncompressed_bytes < limits.zip.max_total_uncompressed_bytes);
        assert!(limits.image.max_pixels.saturating_mul(4) <= limits.image.max_decoded_bytes);
        assert!(limits.mobi.max_file_bytes < limits.mobi.max_declared_text_bytes);
    }

    #[test]
    fn rejects_forged_entry_count_before_zip_directory_allocation() {
        let path = std::env::temp_dir().join(format!("readest-zip-count-{}", std::process::id()));
        let mut bytes = zip_with_entry(b"small", zip::CompressionMethod::Stored);
        let eocd = bytes
            .windows(4)
            .rposition(|window| window == [0x50, 0x4b, 0x05, 0x06])
            .unwrap();
        let forged = (limits().zip.max_entries + 1) as u16;
        bytes[eocd + 10..eocd + 12].copy_from_slice(&forged.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        assert_eq!(
            validate_zip_file(&path).unwrap_err(),
            resource_limit_error()
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_forged_huge_zip_entry_from_central_directory() {
        let mut bytes = zip_with_entry(b"small", zip::CompressionMethod::Stored);
        let central = bytes
            .windows(4)
            .position(|window| window == [0x50, 0x4b, 0x01, 0x02])
            .unwrap();
        let forged = (limits().zip.max_entry_uncompressed_bytes + 1) as u32;
        bytes[central + 24..central + 28].copy_from_slice(&forged.to_le_bytes());

        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(
            validate_zip_archive(&mut archive).unwrap_err(),
            resource_limit_error()
        );
    }

    #[test]
    fn rejects_small_high_ratio_compression_bomb_fixture() {
        let expanded = vec![0u8; 2 * 1024 * 1024];
        let bytes = zip_with_entry(&expanded, zip::CompressionMethod::Deflated);
        assert!(bytes.len() < 32 * 1024, "fixture must stay small");

        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(
            validate_zip_archive(&mut archive).unwrap_err(),
            resource_limit_error()
        );
    }

    #[test]
    fn accepts_normal_epub_sized_entry() {
        let bytes = zip_with_entry(
            b"<html><body>Hello</body></html>",
            zip::CompressionMethod::Deflated,
        );
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        validate_zip_archive(&mut archive).unwrap();
    }

    #[test]
    fn rejects_oversized_mobi_text_declaration_from_tiny_fixture() {
        let path =
            std::env::temp_dir().join(format!("readest-mobi-declaration-{}", std::process::id()));
        let mut bytes = vec![0u8; 94];
        bytes[78..82].copy_from_slice(&82u32.to_be_bytes());
        let declared = (limits().mobi.max_declared_text_bytes + 1) as u32;
        bytes[86..90].copy_from_slice(&declared.to_be_bytes());
        std::fs::write(&path, bytes).unwrap();

        assert_eq!(
            validate_mobi_file(&path).unwrap_err(),
            resource_limit_error()
        );
        std::fs::remove_file(path).unwrap();
    }
}
