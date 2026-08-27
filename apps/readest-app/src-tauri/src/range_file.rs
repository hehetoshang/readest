// Custom `rangefile` URI scheme that serves byte ranges of local files to the
// WebView WITHOUT using a `Range` request header.
//
// Why this exists: on Android the WebView mishandles `Range` requests served
// through `shouldInterceptRequest` — it re-applies the range offset to the
// already-sliced intercepted body (skips `start` bytes a second time), so any
// non-zero-start range served by the asset protocol returns corrupt data or
// `net::ERR_FAILED` (Chromium 40739128; tauri-apps/tauri#12019, #3725). That
// makes `RemoteFile`'s random-access reads unusable through the asset protocol
// on Android.
//
// This scheme sidesteps the bug by encoding the range in the URL query
// (`?path=..&start=..&end=..`) instead of a `Range` header. With no `Range`
// header present the WebView performs no offset re-application and delivers the
// 200 body verbatim, while the bytes still stream through the WebView network
// stack (not the slow Tauri IPC bridge). Security mirrors the asset protocol:
// only paths allowed by `asset_protocol_scope` are served.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

/// Scheme name; the WebView reaches it at `http://rangefile.localhost/`.
pub const SCHEME: &str = "rangefile";

/// Upper bound on bytes returned for a single request. `RemoteFile` already
/// chunks its reads well below this; the cap just bounds a pathological range.
const MAX_RANGE_LEN: u64 = 8 * 1024 * 1024;

/// Parsed `?path=..&start=..&end=..` query. `end` is inclusive (matches
/// `RemoteFile.fetchRangePart`); omitted `end` means "to EOF".
struct RangeQuery {
    path: PathBuf,
    start: u64,
    end: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResponseDispatch {
    CurrentWorker,
    BlockingPool,
}

const fn response_dispatch(is_android: bool) -> ResponseDispatch {
    if is_android {
        ResponseDispatch::CurrentWorker
    } else {
        ResponseDispatch::BlockingPool
    }
}

fn bounded_range(total: u64, start: u64, end: Option<u64>) -> (u64, u64) {
    let start = start.min(total);
    let last = total.saturating_sub(1);
    let end = end.unwrap_or(last).min(last);
    let len = if total == 0 || start > end {
        0
    } else {
        (end + 1 - start).min(MAX_RANGE_LEN)
    };
    (start, len)
}

fn read_bounded_range<R: Read + Seek>(
    reader: &mut R,
    total: u64,
    requested_start: u64,
    requested_end: Option<u64>,
) -> std::io::Result<Vec<u8>> {
    let (start, nbytes) = bounded_range(total, requested_start, requested_end);
    if nbytes == 0 {
        return Ok(Vec::new());
    }
    reader.seek(SeekFrom::Start(start))?;
    let mut bytes = vec![0; nbytes as usize];
    let mut filled = 0;
    while filled < bytes.len() {
        let read = reader.read(&mut bytes[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    bytes.truncate(filled);
    Ok(bytes)
}

fn parse_query(uri_query: Option<&str>) -> Option<RangeQuery> {
    let query = uri_query?;
    let mut path: Option<PathBuf> = None;
    let mut start: u64 = 0;
    let mut end: Option<u64> = None;
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let key = it.next().unwrap_or("");
        let val = it.next().unwrap_or("");
        match key {
            "path" => {
                let decoded = percent_encoding::percent_decode_str(val)
                    .decode_utf8_lossy()
                    .into_owned();
                if !decoded.is_empty() {
                    path = Some(PathBuf::from(decoded));
                }
            }
            "start" => start = val.parse().ok()?,
            "end" => end = Some(val.parse().ok()?),
            _ => {}
        }
    }
    Some(RangeQuery {
        path: path?,
        start,
        end,
    })
}

/// Defense-in-depth path guard, mirroring the asset protocol's `SafePathBuf`:
/// reject anything that isn't an absolute, traversal-free, NUL-free path BEFORE
/// the scope check. The scope's `is_allowed` already canonicalizes (resolving
/// `..`/symlinks) for existing files, so this is redundant for the security
/// outcome — but it fails closed and keeps the handler obviously-correct
/// instead of relying on that canonicalization subtlety.
fn is_safe_path(path: &Path) -> bool {
    path.is_absolute()
        && !path.to_string_lossy().contains('\0')
        && !path.components().any(|c| matches!(c, Component::ParentDir))
}

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    // Derive CORS from the actual requesting WebView, like Tauri's built-in
    // asset protocol. Never trust or reflect the request's Origin value.
    let trusted_origin = pinned_window_origin(&ctx);

    // Android invokes custom protocols from WebView's shouldInterceptRequest
    // worker and waits for the response on that worker. Handing the responder
    // to Tauri's blocking pool can leave that intercepted request pending in
    // embedded hosts (notably Moke), so every RemoteFile read waits forever and
    // the reader never gets past its loading indicator. File I/O is already off
    // the Android UI thread; respond on the current worker as the original
    // rangefile implementation did.
    match response_dispatch(cfg!(target_os = "android")) {
        ResponseDispatch::CurrentWorker => {
            responder.respond(build_response(
                ctx.app_handle(),
                &request,
                trusted_origin.as_deref(),
            ));
        }
        // WKWebView invokes the scheme handler on the main thread. Keep Apple
        // and desktop platforms on the blocking pool so scope canonicalization
        // and a large/not-yet-materialized file cannot stall the UI.
        ResponseDispatch::BlockingPool => {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(build_response(&app, &request, trusted_origin.as_deref()));
            });
        }
    }
}

fn trusted_app_origin(label: &str, url: &tauri::Url) -> Option<String> {
    let trusted_label =
        label == "main" || label.starts_with("reader-") || label.starts_with("moke-home-");
    if !trusted_label {
        return None;
    }

    let host = url.host_str().unwrap_or_default();
    let trusted = matches!(
        (url.scheme(), host, url.port()),
        ("tauri", "localhost", None)
            | ("http" | "https", "tauri.localhost", None)
            | (
                "http",
                "localhost" | "127.0.0.1" | "[::1]" | "::1",
                Some(3000) | Some(3001)
            )
    );
    trusted.then(|| {
        format!(
            "{}://{}{}",
            url.scheme(),
            host,
            url.port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default()
        )
    })
}

fn pinned_window_origin<R: Runtime>(ctx: &UriSchemeContext<'_, R>) -> Option<String> {
    let webview = ctx.app_handle().get_webview_window(ctx.webview_label())?;
    let url = webview.url().ok()?;
    trusted_app_origin(ctx.webview_label(), &url)
}

fn request_origin(request: &Request<Vec<u8>>) -> Option<&str> {
    request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
}

fn validate_request_origin<'a>(
    trusted_origin: Option<&'a str>,
    supplied_origin: Option<&str>,
    is_preflight: bool,
) -> Result<&'a str, StatusCode> {
    let trusted_origin = trusted_origin.ok_or(StatusCode::FORBIDDEN)?;
    if supplied_origin.is_some_and(|origin| origin != trusted_origin)
        || (is_preflight && supplied_origin.is_none())
    {
        Err(StatusCode::FORBIDDEN)
    } else {
        Ok(trusted_origin)
    }
}

fn response_builder(status: StatusCode, origin: Option<&str>) -> tauri::http::response::Builder {
    let builder = Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .header("Vary", "Origin");
    if let Some(origin) = origin {
        builder.header("Access-Control-Allow-Origin", origin)
    } else {
        builder
    }
}

fn error(origin: Option<&str>, status: StatusCode) -> Response<Vec<u8>> {
    response_builder(status, origin).body(Vec::new()).unwrap()
}

fn preflight(origin: &str) -> Response<Vec<u8>> {
    response_builder(StatusCode::NO_CONTENT, Some(origin))
        .header("Access-Control-Allow-Methods", "GET, OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type")
        .header("Access-Control-Max-Age", "600")
        .body(Vec::new())
        .unwrap()
}

fn is_sensitive_protocol_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let file_name = normalized
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        file_name.as_str(),
        "moke-downloads.json"
            | "moke-downloads.json.tmp"
            | "download-directory.json"
            | "download-directory.json.tmp"
            | "settings.json"
            | "settings.json.bak"
            | "feeds.json"
            | "feeds.json.bak"
    )
}

fn build_response<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request<Vec<u8>>,
    trusted_origin: Option<&str>,
) -> Response<Vec<u8>> {
    let is_preflight = request.method() == tauri::http::Method::OPTIONS;
    let origin =
        match validate_request_origin(trusted_origin, request_origin(request), is_preflight) {
            Ok(origin) => origin,
            Err(status) => return error(trusted_origin, status),
        };
    if is_preflight {
        return preflight(origin);
    }
    if request.method() != tauri::http::Method::GET {
        return error(Some(origin), StatusCode::METHOD_NOT_ALLOWED);
    }

    let query = match parse_query(request.uri().query()) {
        Some(q) => q,
        None => return error(Some(origin), StatusCode::BAD_REQUEST),
    };

    // Defense-in-depth: reject traversal/NUL/relative paths outright.
    if !is_safe_path(&query.path) {
        log::warn!("rangefile: rejected unsafe path: {:?}", query.path);
        return error(Some(origin), StatusCode::FORBIDDEN);
    }

    let canonical_path = match query.path.canonicalize() {
        Ok(path) => path,
        Err(error_value) => {
            let status = match error_value.kind() {
                std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return error(Some(origin), status);
        }
    };

    if is_sensitive_protocol_path(&query.path) || is_sensitive_protocol_path(&canonical_path) {
        log::warn!("rangefile: rejected sensitive application file");
        return error(Some(origin), StatusCode::FORBIDDEN);
    }

    // Security: identical boundary to the asset protocol — only paths the
    // importer/picker has granted are readable.
    if !app.asset_protocol_scope().is_allowed(&canonical_path) {
        log::warn!(
            "rangefile: path not allowed by asset scope: {:?}",
            query.path
        );
        return error(Some(origin), StatusCode::FORBIDDEN);
    }

    let mut file = match File::open(&canonical_path) {
        Ok(f) => f,
        Err(e) => {
            let status = match e.kind() {
                std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return error(Some(origin), status);
        }
    };

    let total = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return error(Some(origin), StatusCode::INTERNAL_SERVER_ERROR),
    };

    let buf = match read_bounded_range(&mut file, total, query.start, query.end) {
        Ok(bytes) => bytes,
        Err(_) => return error(Some(origin), StatusCode::INTERNAL_SERVER_ERROR),
    };

    // 200 (not 206) and NO `Content-Range`: the range was carried in the URL,
    // not a `Range` header, so the WebView delivers this body verbatim.
    response_builder(StatusCode::OK, Some(origin))
        .header(
            "Access-Control-Expose-Headers",
            "X-Total-Size, Content-Length",
        )
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", buf.len().to_string())
        .header("X-Total-Size", total.to_string())
        .header("Cache-Control", "no-store")
        .body(buf)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_path_start_end() {
        let q = parse_query(Some("path=%2Fbooks%2Fa.epub&start=1024&end=2047")).unwrap();
        assert_eq!(q.path, PathBuf::from("/books/a.epub"));
        assert_eq!(q.start, 1024);
        assert_eq!(q.end, Some(2047));
    }

    #[test]
    fn decodes_utf8_path() {
        // encodeURIComponent("/书/堂吉诃德.mobi")
        let q = parse_query(Some(
            "path=%2F%E4%B9%A6%2F%E5%A0%82%E5%90%89%E8%AF%83%E5%BE%B7.mobi&start=0&end=0",
        ))
        .unwrap();
        assert_eq!(q.path, PathBuf::from("/书/堂吉诃德.mobi"));
    }

    #[test]
    fn missing_path_is_none() {
        assert!(parse_query(Some("start=0&end=10")).is_none());
        assert!(parse_query(None).is_none());
    }

    #[test]
    fn end_omitted_means_eof() {
        let q = parse_query(Some("path=%2Fa&start=5")).unwrap();
        assert_eq!(q.start, 5);
        assert_eq!(q.end, None);
    }

    #[test]
    fn malformed_range_values_are_rejected() {
        assert!(parse_query(Some("path=%2Fa&start=wat&end=10")).is_none());
        assert!(parse_query(Some("path=%2Fa&start=0&end=wat")).is_none());
        assert!(parse_query(Some("path=%2Fa&start=-1&end=10")).is_none());
    }

    #[test]
    fn ampersand_and_equals_in_path_are_percent_encoded() {
        // encodeURIComponent("/a&b=c.epub") -> %2Fa%26b%3Dc.epub
        let q = parse_query(Some("path=%2Fa%26b%3Dc.epub&start=0")).unwrap();
        assert_eq!(q.path, PathBuf::from("/a&b=c.epub"));
    }

    #[test]
    fn safe_path_accepts_absolute_traversal_free() {
        assert!(is_safe_path(Path::new(
            "/data/user/0/com.bilingify.readest/Readest/Books/a.epub"
        )));
        assert!(is_safe_path(Path::new("/书/堂吉诃德.mobi")));
    }

    #[test]
    fn safe_path_rejects_parent_dir_traversal() {
        assert!(!is_safe_path(Path::new(
            "/data/user/0/com.bilingify.readest/Readest/../../../../etc/passwd"
        )));
        assert!(!is_safe_path(Path::new("/a/../b")));
    }

    #[test]
    fn safe_path_rejects_relative_and_nul() {
        assert!(!is_safe_path(Path::new("data/x/a.epub"))); // not absolute
        assert!(!is_safe_path(Path::new("a.epub")));
        assert!(!is_safe_path(Path::new("/data/a\0b.epub"))); // NUL byte
    }

    #[test]
    fn android_dispatches_on_the_current_webview_worker() {
        assert_eq!(
            response_dispatch(true),
            ResponseDispatch::CurrentWorker,
            "Android must not hand an intercepted request to another pool"
        );
    }

    #[test]
    fn non_android_dispatches_on_the_blocking_pool() {
        assert_eq!(response_dispatch(false), ResponseDispatch::BlockingPool);
    }

    #[test]
    fn bounded_range_clamps_to_file_and_requested_end() {
        assert_eq!(bounded_range(100, 10, Some(19)), (10, 10));
        assert_eq!(bounded_range(100, 90, Some(200)), (90, 10));
        assert_eq!(bounded_range(100, 50, None), (50, 50));
    }

    #[test]
    fn bounded_range_handles_empty_reversed_and_past_eof_requests() {
        assert_eq!(bounded_range(0, 0, None), (0, 0));
        assert_eq!(bounded_range(100, 80, Some(20)), (80, 0));
        assert_eq!(bounded_range(100, 150, None), (100, 0));
    }

    #[test]
    fn bounded_range_caps_pathological_requests() {
        assert_eq!(
            bounded_range(MAX_RANGE_LEN * 2, 0, None),
            (0, MAX_RANGE_LEN)
        );
    }

    #[test]
    fn reads_a_legal_inclusive_range() {
        let mut file = std::io::Cursor::new(b"0123456789".to_vec());
        assert_eq!(
            read_bounded_range(&mut file, 10, 2, Some(5)).unwrap(),
            b"2345"
        );
    }

    #[test]
    fn cors_origin_is_derived_from_the_requesting_app_window() {
        for (label, url) in [
            ("main", "tauri://localhost/library"),
            ("reader-42", "http://tauri.localhost/readest/reader"),
            ("moke-home-1", "https://tauri.localhost/readest/library"),
            ("main", "http://localhost:3000/library"),
            ("reader-42", "http://127.0.0.1:3001/reader"),
        ] {
            let url = tauri::Url::parse(url).unwrap();
            assert!(trusted_app_origin(label, &url).is_some(), "{label} {url}");
        }
        for (label, url) in [
            ("clip-attacker", "https://example.com"),
            ("reader-42", "https://example.com"),
            ("main", "http://localhost:4444"),
            ("untrusted", "http://tauri.localhost"),
        ] {
            let url = tauri::Url::parse(url).unwrap();
            assert!(trusted_app_origin(label, &url).is_none(), "{label} {url}");
        }
    }

    #[test]
    fn malicious_origins_and_originless_preflights_are_rejected() {
        let trusted = "http://tauri.localhost";
        assert_eq!(
            validate_request_origin(Some(trusted), Some(trusted), true),
            Ok(trusted)
        );
        assert_eq!(
            validate_request_origin(Some(trusted), Some("https://evil.example"), false),
            Err(StatusCode::FORBIDDEN)
        );
        assert_eq!(
            validate_request_origin(Some(trusted), None, true),
            Err(StatusCode::FORBIDDEN)
        );
        assert_eq!(
            validate_request_origin(None, Some(trusted), false),
            Err(StatusCode::FORBIDDEN)
        );
    }

    #[test]
    fn preflight_and_errors_always_emit_the_pinned_origin() {
        let response = preflight("http://tauri.localhost");
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response
                .headers()
                .get("Access-Control-Allow-Origin")
                .unwrap(),
            "http://tauri.localhost"
        );
        assert_eq!(
            response
                .headers()
                .get("Access-Control-Allow-Methods")
                .unwrap(),
            "GET, OPTIONS"
        );

        let response = error(Some("http://tauri.localhost"), StatusCode::FORBIDDEN);
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response
                .headers()
                .get("Access-Control-Allow-Origin")
                .unwrap(),
            "http://tauri.localhost"
        );
        assert_ne!(
            response
                .headers()
                .get("Access-Control-Allow-Origin")
                .unwrap(),
            "https://evil.example"
        );
        assert_eq!(response.headers().get("Cache-Control").unwrap(), "no-store");
    }

    #[test]
    fn sensitive_indexes_and_settings_are_never_served() {
        for path in [
            "/appdata/moke-downloads.json",
            "/appdata/download-directory.json",
            "/appconfig/settings.json",
            "/appconfig/settings.json.bak",
            "/appconfig/feeds.json",
            "/appconfig/feeds.json.bak",
            r"C:\Users\u\AppData\Roaming\Moke\MOKE-DOWNLOADS.JSON",
        ] {
            assert!(is_sensitive_protocol_path(Path::new(path)), "{path}");
        }
        assert!(!is_sensitive_protocol_path(Path::new(
            "/appdata/books/novel.epub"
        )));
    }

    #[test]
    fn standalone_asset_scope_uses_only_an_app_specific_temp_subdirectory() {
        let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(config_path).unwrap()).unwrap();
        let allow = config["app"]["security"]["assetProtocol"]["scope"]["allow"]
            .as_array()
            .unwrap();
        let paths: Vec<_> = allow.iter().filter_map(|value| value.as_str()).collect();
        assert!(!paths
            .iter()
            .any(|path| *path == "$TEMP/**/*" || *path == "$TEMP/**"));
        assert!(paths.iter().any(|path| path.starts_with("$TEMP/readest/")));
        assert!(!paths.iter().any(|path| path.starts_with("**/")));

        let deny = config["app"]["security"]["assetProtocol"]["scope"]["deny"]
            .as_array()
            .unwrap();
        let denied_paths: Vec<_> = deny.iter().filter_map(|value| value.as_str()).collect();
        for path in [
            "$APPDATA/moke-downloads.json",
            "$APPDATA/download-directory.json",
            "$APPCONFIG/settings.json",
            "$APPCONFIG/feeds.json",
        ] {
            assert!(denied_paths.contains(&path), "{path} must be denied");
        }
    }
}
