// Spawn a hidden Tauri webview that loads the target URL with the real
// browser engine (WebKit2GTK / WKWebView / WebView2), wait for the page to
// render including JS, and stream the rendered `outerHTML` back to the
// caller. Solves the Cloudflare / Medium / paywall case the Rust HTTP
// client cannot: a real browser carries the correct TLS fingerprint and
// runs the page's own scripts, so bot challenges resolve naturally.
//
// Bridge from webview → Rust:
//
//   The first attempt used a custom `readest-clip://` URI scheme + `fetch`.
//   WebKit treats custom (non-https) schemes as *insecure content* when
//   called from an https origin and blocks them — that's not a CSP rule we
//   can relax. Browsers DO treat `http://127.0.0.1` as a potentially-
//   trustworthy origin (no mixed-content block from https), so we spin up
//   a one-shot localhost HTTP server per clip and the init script POSTs
//   the outerHTML to it. Same pattern `tauri-plugin-oauth` uses.
//
// Wire shape:
//
//   [JS]                       [Rust]                       [hidden webview]
//   invoke('clip_url', url) ─┬─▶ bind 127.0.0.1:RANDOM_PORT
//                            │
//                            ├─▶ WebviewWindowBuilder::External(url)
//                            │   + initialization_script(port, token)
//                            │
//                            │            (page loads, JS runs)
//                            │
//                            │   ◀─── fetch('http://127.0.0.1:{port}/clip/{token}',
//                            │           { method: 'POST', body: outerHTML })
//                            │
//                            │   the tokio listener accepts, parses the
//                            │   request, sends body via oneshot
//                            │
//                            ▼
//   ◀── outerHTML                close webview, return HTML

use serde::Deserialize;
#[cfg(desktop)]
use std::net::ToSocketAddrs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;
use tauri::{AppHandle, Url, WebviewWindow};

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(desktop)]
use tokio::net::TcpListener;
#[cfg(desktop)]
use tokio::sync::oneshot;

/// Localised strings and theme colours supplied by the JS caller. Defaults
/// are English / Readest's dark palette so a caller that omits a field
/// (tests, future Rust-only callers) still gets readable text and chrome.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipOptions {
    pub window_title: Option<String>,
    pub overlay_title: Option<String>,
    pub loading_status: Option<String>,
    pub capturing_status: Option<String>,
    pub saved_title: Option<String>,
    /// `#rrggbb` — matches `themeCode.bg` (base-100) in the renderer.
    pub background: Option<String>,
    /// `#rrggbb` — matches `themeCode.fg` (base-content) in the renderer.
    pub foreground: Option<String>,
    /// Interactive mode (mobile only): show the page with a
    /// Cancel/Capture bar instead of the opaque overlay so the user can
    /// sign in before capturing. Desktop ignores it.
    pub interactive: Option<bool>,
    pub sign_in_hint: Option<String>,
    pub capture_label: Option<String>,
    pub cancel_label: Option<String>,
}

impl ClipOptions {
    fn window_title(&self) -> &str {
        self.window_title
            .as_deref()
            .unwrap_or("Saving to your Readest library…")
    }
    fn overlay_title(&self) -> &str {
        self.overlay_title.as_deref().unwrap_or("Saving to Readest")
    }
    fn loading_status(&self) -> &str {
        self.loading_status.as_deref().unwrap_or("Loading article…")
    }
    fn capturing_status(&self) -> &str {
        self.capturing_status
            .as_deref()
            .unwrap_or("Capturing article…")
    }
    fn saved_title(&self) -> &str {
        self.saved_title.as_deref().unwrap_or("Saved to Readest")
    }
    fn background(&self) -> &str {
        self.background.as_deref().unwrap_or("#1f2024")
    }
    fn foreground(&self) -> &str {
        self.foreground.as_deref().unwrap_or("#f5f5f7")
    }
}

/// Parse a `#rrggbb` colour string into 8-bit RGB components. Returns
/// `None` for any malformed input — the caller falls back to whatever
/// default it had.
fn parse_hex_color(s: &str) -> Option<(u8, u8, u8)> {
    let hex = s.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

/// HTML-escape a translated string before inlining it into the bridge
/// page or the loading overlay's static markup. JS string literals use
/// `serde_json::to_string` (which already escapes correctly for JS).
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Monotonic + nanosecond timestamp token — unique enough; the token is
/// not a security boundary on its own (the listener only binds to
/// 127.0.0.1 and we close it after the first valid POST), but it makes
/// the URL path predictable for debugging and prevents a rogue process
/// on the loopback interface from accidentally hitting us.
#[cfg(desktop)]
fn next_token() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}{:x}", ts, n)
}

/// Rendered DOM returned by the clip webview. This keeps a hostile page from
/// turning the navigation-based bridge into a tens-of-megabytes allocation.
const MAX_CAPTURE_HTML_BYTES: usize = 8 * 1024 * 1024;
const MAX_CAPTURE_B64_BYTES: usize = MAX_CAPTURE_HTML_BYTES / 3 * 4
    + if MAX_CAPTURE_HTML_BYTES % 3 == 0 {
        0
    } else {
        4
    };
const DNS_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_CLIP_NAVIGATIONS: usize = 10;

// The request URL carries the page HTML as base64. Allow exactly the encoded
// capture ceiling plus a small amount of request-line/header overhead.
#[cfg(desktop)]
const MAX_REQUEST_BYTES: usize = MAX_CAPTURE_B64_BYTES + 64 * 1024;
#[cfg(desktop)]
const READ_CHUNK_BYTES: usize = 64 * 1024;
#[cfg(desktop)]
const SOCKET_TIMEOUT: Duration = Duration::from_secs(10);

fn is_forbidden_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _d] = address.octets();
    address.is_unspecified()
        || address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_multicast()
        || a == 0
        || a >= 240
        || (a == 100 && (64..=127).contains(&b)) // carrier-grade NAT
        || (a == 100 && b == 100 && c == 100) // Alibaba metadata service
        || (a == 192 && b == 0 && c == 0) // IETF protocol assignments
        || (a == 192 && b == 0 && c == 2) // documentation
        || (a == 198 && (b == 18 || b == 19)) // benchmark networks
        || (a == 198 && b == 51 && c == 100) // documentation
        || (a == 203 && b == 0 && c == 113) // documentation
}

fn mapped_ipv4(address: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(address) = address.to_ipv4_mapped() {
        return Some(address);
    }
    let octets = address.octets();
    octets[..12]
        .iter()
        .all(|byte| *byte == 0)
        .then(|| Ipv4Addr::new(octets[12], octets[13], octets[14], octets[15]))
}

fn is_forbidden_target_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_forbidden_ipv4(address),
        IpAddr::V6(address) => {
            let octets = address.octets();
            address.is_unspecified()
                || address.is_loopback()
                || address.is_multicast()
                || octets[0] & 0xfe == 0xfc // unique-local fc00::/7
                || (octets[0] == 0xfe && octets[1] & 0xc0 == 0x80) // link-local fe80::/10
                || mapped_ipv4(address).is_some_and(is_forbidden_ipv4)
        }
    }
}

fn validate_resolved_target(url: &Url, addresses: &[IpAddr]) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("URL must use http or https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL credentials are not allowed".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL must include a host".to_string())?;
    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized_host == "localhost"
        || normalized_host.ends_with(".localhost")
        || normalized_host == "metadata.google.internal"
    {
        return Err("URL target is not public".into());
    }
    if addresses.is_empty() {
        return Err("URL host did not resolve".into());
    }
    if let Some(address) = addresses
        .iter()
        .copied()
        .find(|address| is_forbidden_target_ip(*address))
    {
        return Err(format!("URL target address is not public: {address}"));
    }
    Ok(())
}

fn literal_target_address(url: &Url) -> Option<IpAddr> {
    url.host_str()?.trim_matches(['[', ']']).parse().ok()
}

async fn validate_public_target(url: &Url) -> Result<(), String> {
    if let Some(address) = literal_target_address(url) {
        return validate_resolved_target(url, &[address]);
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL must include a host".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL must include a valid port".to_string())?;
    let resolved =
        tokio::time::timeout(DNS_TIMEOUT, tokio::net::lookup_host((host.as_str(), port)))
            .await
            .map_err(|_| "URL host resolution timed out".to_string())?
            .map_err(|_| "URL host could not be resolved".to_string())?;
    let addresses: Vec<_> = resolved.map(|socket| socket.ip()).collect();
    validate_resolved_target(url, &addresses)
}

#[cfg(desktop)]
fn validate_public_target_blocking(url: &Url) -> Result<(), String> {
    if let Some(address) = literal_target_address(url) {
        return validate_resolved_target(url, &[address]);
    }
    // Navigation callbacks are synchronous. Keep DNS off the webview thread
    // and fail closed if the platform resolver does not answer promptly.
    let url = url.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = (|| {
            let host = url
                .host_str()
                .ok_or_else(|| "URL must include a host".to_string())?;
            let port = url
                .port_or_known_default()
                .ok_or_else(|| "URL must include a valid port".to_string())?;
            let addresses: Vec<_> = (host, port)
                .to_socket_addrs()
                .map_err(|_| "URL host could not be resolved".to_string())?
                .map(|socket| socket.ip())
                .collect();
            validate_resolved_target(&url, &addresses)
        })();
        let _ = tx.send(result);
    });
    rx.recv_timeout(DNS_TIMEOUT)
        .map_err(|_| "URL host resolution timed out".to_string())?
}

fn is_trusted_clip_caller(label: &str, url: &Url) -> bool {
    let trusted_label =
        label == "main" || label.starts_with("reader-") || label.starts_with("moke-home-");
    if !trusted_label {
        return false;
    }
    let host = url.host_str().unwrap_or_default();
    matches!(
        (url.scheme(), host, url.port()),
        ("tauri", "localhost", None)
            | ("http" | "https", "tauri.localhost", None)
            | (
                "http",
                "localhost" | "127.0.0.1" | "[::1]" | "::1",
                Some(3000) | Some(3001)
            )
    )
}

fn ensure_trusted_clip_caller(caller: &WebviewWindow) -> Result<(), String> {
    let url = caller
        .url()
        .map_err(|_| "Could not verify clip_url caller".to_string())?;
    if is_trusted_clip_caller(caller.label(), &url) {
        Ok(())
    } else {
        Err("clip_url may only be called from a trusted application page".into())
    }
}

/// Find the `\r\n\r\n` that terminates the HTTP request headers.
#[cfg(desktop)]
fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Pull `Content-Length` out of header bytes (case-insensitive).
#[cfg(desktop)]
fn parse_content_length(headers: &str) -> usize {
    for line in headers.split("\r\n").skip(1) {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                return value.trim().parse().unwrap_or(0);
            }
        }
    }
    0
}

/// Capture loop. The clip webview navigates to
/// `GET /clip/{token}?d={base64-HTML}` — top-level navigation isn't
/// governed by CSP `connect-src` / `form-action`, and the URL itself
/// carries the data (so we don't need any cross-origin storage trick).
/// Server decodes the base64, signals the oneshot, returns a tiny
/// "captured" page so the user can see the round-trip worked.
#[cfg(desktop)]
async fn capture_one(
    listener: TcpListener,
    token: String,
    tx: oneshot::Sender<Result<String, String>>,
    saved_title: String,
    background: String,
    foreground: String,
) {
    let mut tx = Some(tx);
    let expected_prefix = format!("/clip/{}", token);
    let saved_title_safe = escape_html(&saved_title);
    // CSS-context escape: the caller-provided colour goes into a
    // `style="…"` attribute. Reuse the HTML escape so any quote /
    // angle-bracket can't break out of the attribute or smuggle markup.
    let bg_css = escape_html(&background);
    let fg_css = escape_html(&foreground);
    loop {
        let Ok((mut stream, _peer)) = listener.accept().await else {
            break;
        };

        let mut buf = Vec::with_capacity(READ_CHUNK_BYTES);
        let mut chunk = vec![0u8; READ_CHUNK_BYTES];
        let mut header_end: Option<usize> = None;
        let mut content_length: usize = 0;

        loop {
            if buf.len() > MAX_REQUEST_BYTES {
                break;
            }
            let read = tokio::time::timeout(SOCKET_TIMEOUT, stream.read(&mut chunk)).await;
            let n = match read {
                Ok(Ok(n)) if n > 0 => n,
                _ => break,
            };
            buf.extend_from_slice(&chunk[..n]);
            if header_end.is_none() {
                if let Some(idx) = find_header_end(&buf) {
                    header_end = Some(idx);
                    let headers_str = std::str::from_utf8(&buf[..idx]).unwrap_or("");
                    content_length = parse_content_length(headers_str);
                }
            }
            if let Some(idx) = header_end {
                if buf.len() >= idx + 4 + content_length {
                    break;
                }
            }
        }

        let Some(hdr_end) = header_end else {
            continue;
        };
        let headers_str = std::str::from_utf8(&buf[..hdr_end]).unwrap_or("");
        let first_line = headers_str.lines().next().unwrap_or("");
        let mut parts = first_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("");

        // `target` is the request-target — `/clip/{token}?d=...`. Split
        // path vs query.
        let (path, query) = match target.find('?') {
            Some(i) => (&target[..i], &target[i + 1..]),
            None => (target, ""),
        };

        if method != "GET" || path != expected_prefix {
            let _ = stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                .await;
            continue;
        }

        // Decode `d=<base64>` out of the query string.
        let mut data_b64: Option<&str> = None;
        for pair in query.split('&') {
            if let Some(v) = pair.strip_prefix("d=") {
                data_b64 = Some(v);
                break;
            }
        }
        let html = match data_b64.and_then(decode_b64) {
            Some(s) => s,
            None => {
                let body = b"capture: missing, invalid, or oversized `d` query param";
                let mut response = Vec::with_capacity(128 + body.len());
                response.extend_from_slice(b"HTTP/1.1 413 Content Too Large\r\n");
                response.extend_from_slice(b"Content-Type: text/plain; charset=utf-8\r\n");
                response.extend_from_slice(
                    format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes(),
                );
                response.extend_from_slice(body);
                let _ = stream.write_all(&response).await;
                if let Some(tx) = tx.take() {
                    let _ = tx.send(Err("Captured page is too large or invalid".into()));
                }
                break;
            }
        };

        // Tell the user / devtools the round-trip succeeded with the
        // same look as the loading overlay — same dark background,
        // checkmark instead of spinner. Window closes a moment later.
        let confirmation = format!(
            r##"<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;height:100vh;background:{bg};color:{fg};
font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,sans-serif;
display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
padding:24px;box-sizing:border-box;text-align:center">
<div style="width:36px;height:36px;border-radius:50%;background:rgba(76,175,80,0.18);
display:flex;align-items:center;justify-content:center">
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7cd47e"
stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
</div>
<div style="font-size:15px;font-weight:600">{title}</div>
</body></html>"##,
            title = saved_title_safe,
            bg = bg_css,
            fg = fg_css,
        );
        // bytes count was diagnostic-only; dropped from the user-facing
        // page so the captured-state stays clean across locales.
        let _ = html.len();
        let mut response = Vec::with_capacity(256 + confirmation.len());
        response.extend_from_slice(b"HTTP/1.1 200 OK\r\n");
        response.extend_from_slice(b"Content-Type: text/html; charset=utf-8\r\n");
        response.extend_from_slice(
            format!("Content-Length: {}\r\n\r\n", confirmation.len()).as_bytes(),
        );
        response.extend_from_slice(confirmation.as_bytes());
        let _ = stream.write_all(&response).await;

        if let Some(tx) = tx.take() {
            let _ = tx.send(Ok(html));
        }
        break;
    }
}

/// Decode a URL-safe base64 string (the JS side uses `btoa` which
/// produces standard base64; we also accept URL-safe variants in case
/// a future caller swaps). Returns the decoded UTF-8 string, or None
/// on any decode error.
#[cfg(desktop)]
fn decode_b64(s: &str) -> Option<String> {
    use base64::Engine as _;
    if s.len() > MAX_CAPTURE_B64_BYTES {
        return None;
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .ok()?;
    if bytes.len() > MAX_CAPTURE_HTML_BYTES {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Inject a fullscreen loading overlay before the page renders so the
/// user sees a deliberate "Saving…" UI instead of the article flashing
/// by. The overlay is `position:fixed` with the maximum z-index and
/// re-attaches itself for a few hundred milliseconds in case the page's
/// hydration step wipes our node. It's just chrome — the page
/// underneath still loads, runs scripts, and fires its lazy-loaders.
#[cfg(desktop)]
fn loading_overlay_script(
    overlay_title: &str,
    loading_status: &str,
    background: &str,
    foreground: &str,
) -> String {
    // Inline as JS string literals (JSON encoding handles the escapes).
    // `textContent` assignment avoids any HTML injection risk from the
    // translated strings themselves; JSON-encoding the colour values
    // makes any unexpected character (a stray quote, a CSS expression)
    // a syntax error rather than a CSS injection.
    let title_json = serde_json::to_string(overlay_title).unwrap_or_else(|_| "\"\"".into());
    let status_json = serde_json::to_string(loading_status).unwrap_or_else(|_| "\"\"".into());
    let bg_json = serde_json::to_string(background).unwrap_or_else(|_| "\"#1f2024\"".into());
    let fg_json = serde_json::to_string(foreground).unwrap_or_else(|_| "\"#f5f5f7\"".into());
    format!(
        r#"
        (function() {{
          var TITLE = {title_json};
          var STATUS = {status_json};
          var BG = {bg_json};
          var FG = {fg_json};
          function install() {{
            if (document.getElementById('__readest_overlay__')) return;
            if (!document.documentElement) return;
            var ov = document.createElement('div');
            ov.id = '__readest_overlay__';
            ov.setAttribute('aria-live', 'polite');
            ov.style.cssText = [
              'position:fixed','inset:0',
              'background:' + BG,'color:' + FG,
              'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
              'display:flex','flex-direction:column','align-items:center','justify-content:center',
              'gap:14px','padding:24px','box-sizing:border-box','text-align:center',
              'z-index:2147483647','pointer-events:auto'
            ].join(';');
            var spin = document.createElement('div');
            // Spinner uses the foreground colour with low/high opacity so it
            // reads on both light and dark themes.
            spin.style.cssText = 'width:36px;height:36px;border:3px solid color-mix(in srgb,' +
              ' ' + FG + ' 18%, transparent);' +
              'border-top-color:color-mix(in srgb,' + FG + ' 85%, transparent);' +
              'border-radius:50%;animation:__readest_spin__ 0.8s linear infinite';
            var title = document.createElement('div');
            title.style.cssText = 'font-size:15px;font-weight:600';
            title.textContent = TITLE;
            var status = document.createElement('div');
            status.id = '__readest_status__';
            status.style.cssText = 'font-size:13px;opacity:0.7;max-width:340px;' +
              'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            status.textContent = STATUS;
            var style = document.createElement('style');
            style.textContent = '@keyframes __readest_spin__{{to{{transform:rotate(360deg)}}}}';
            ov.appendChild(spin);
            ov.appendChild(title);
            ov.appendChild(status);
            ov.appendChild(style);
            document.documentElement.appendChild(ov);
          }}
          install();
          var attempts = 0;
          var iv = setInterval(function() {{
            attempts++;
            if (attempts > 30 || document.readyState === 'complete') {{
              install();
              clearInterval(iv);
              return;
            }}
            install();
          }}, 200);
          window.__readest_setStatus__ = function(text) {{
            var el = document.getElementById('__readest_status__');
            if (el) el.textContent = text;
          }};
        }})();
        "#,
    )
}

/// Hide the usual headless-/automation-flavoured signals before the page's
/// own scripts run. The mask doesn't try to be exhaustive — sites with
/// commercial bot detection (X.com, sophisticated paywalls) will still
/// catch us through canvas / WebGL / audio fingerprinting. The goal is
/// just to clear the "you look like Chrome but `navigator.webdriver` is
/// set" tier of checks.
#[cfg(desktop)]
fn fingerprint_mask_script() -> String {
    r#"
    (function() {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      } catch (e) {}
      try {
        // Many Chrome-only objects sites probe for.
        if (!window.chrome) {
          window.chrome = { runtime: {} };
        }
      } catch (e) {}
      try {
        // navigator.languages — some checks see an empty list as suspicious.
        if (navigator.languages && navigator.languages.length === 0) {
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        }
      } catch (e) {}
    })();
    "#
    .to_string()
}

/// Spawn a hidden webview, load `url`, wait for the rendered HTML, return
/// it. Errors:
/// - "Invalid URL" / "URL must use http or https" — pre-flight validation.
/// - "Could not bind capture port: …" — local listener bind failed.
/// - "Could not create clip webview: …" — Tauri couldn't open the window.
/// - "Page took too long to load" — 30 s timeout elapsed without a POST.
/// - "Webview closed before capture" — the page closed itself, or our
///   `close()` raced the script.
#[cfg(desktop)]
#[tauri::command]
pub async fn clip_url(
    app: AppHandle,
    caller: WebviewWindow,
    url: String,
    options: Option<ClipOptions>,
) -> Result<String, String> {
    ensure_trusted_clip_caller(&caller)?;
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    validate_public_target(&parsed).await?;

    let options = options.unwrap_or_default();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not bind capture port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not read capture port: {}", e))?
        .port();

    let token = next_token();
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let token_for_server = token.clone();
    let saved_title_for_server = options.saved_title().to_string();
    let bg_for_server = options.background().to_string();
    let fg_for_server = options.foreground().to_string();
    tokio::spawn(async move {
        capture_one(
            listener,
            token_for_server,
            tx,
            saved_title_for_server,
            bg_for_server,
            fg_for_server,
        )
        .await;
    });

    let label = format!("clip-{}", token);
    let token_json = serde_json::to_string(&token).map_err(|e| e.to_string())?;
    let capturing_status_json =
        serde_json::to_string(options.capturing_status()).map_err(|e| e.to_string())?;
    let max_capture_bytes = MAX_CAPTURE_HTML_BYTES;
    let init_script = format!(
        r#"
        (function() {{
          console.log('[readest-clip] init script running');
          var PORT = {port};
          var TOKEN = {token_json};
          var CAPTURING_STATUS = {capturing_status_json};
          var TARGET = 'http://127.0.0.1:' + PORT + '/clip/' + TOKEN;
          var sent = false;
          function send(reason) {{
            if (sent) return;
            sent = true;
            try {{
              if (window.__readest_setStatus__) {{
                window.__readest_setStatus__(CAPTURING_STATUS);
              }}
              var html = document.documentElement.outerHTML;
              var utf8 = unescape(encodeURIComponent(html));
              console.log('[readest-clip] capturing reason=' + reason +
                ' bytes=' + utf8.length);
              // Transfer the HTML through the navigation URL itself —
              // top-level navigation isn't governed by CSP `connect-src`
              // / `form-action`, and WebKit doesn't enforce Private
              // Network Access on navigation the way it does on fetch.
              // Each earlier transport was blocked by something:
              //   - fetch / XHR        : connect-src + WebKit PNA mixed-content
              //   - <form action=...>  : CSP form-action
              //   - custom URI scheme  : WebKit insecure-content
              //   - window.name + nav  : WebKit clears name on x-origin nav
              // unescape(encodeURIComponent(...)) is the canonical
              // UTF-8 dance before btoa(), which otherwise throws on
              // multi-byte chars (every CJK article).
              // URL-safe base64 — replace +/= so the browser doesn't
              // percent-encode them and the Rust decoder doesn't have to
              // un-encode. Padding stripped.
              if (utf8.length > {max_capture_bytes}) {{
                window.location.assign(TARGET + '?d=oversized');
                return;
              }}
              var b64 = btoa(utf8)
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
              var sep = TARGET.indexOf('?') >= 0 ? '&' : '?';
              window.location.assign(TARGET + sep + 'd=' + b64);
            }} catch (e) {{
              console.warn('[readest-clip] navigate threw:', e && e.message);
            }}
          }}
          // Capture after the load event + a generous settle so JS
          // challenges resolve and IntersectionObserver-based lazy
          // loaders fire for content already in the viewport. We used
          // to scroll top→bottom to force every lazy image to load,
          // but in practice modern sites use a roomy rootMargin and
          // most images on the page have already started loading by
          // the time we hit this point.
          window.addEventListener('load', function() {{
            setTimeout(function() {{ send('load+settle'); }}, 3000);
          }}, {{ once: true }});
          // Hard fallback in case `load` never fires (SPA, error state,
          // long-running redirect chain).
          setTimeout(function() {{ send('hard-timeout'); }}, 20000);
        }})();
        "#,
    );

    // Send a real Chrome UA. Tauri's default UA reports Safari on macOS
    // and Edge/WebView2 on Windows; sites with aggressive bot detection
    // (X / Twitter, some news sites) cross-check the UA against
    // navigator.* fingerprints and reject the mismatch.
    const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                              (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    // macOS doesn't honour `.visible(false)` for a WKWebView that needs
    // its JS timers to keep firing — the public Tauri API can't reach
    // the private NSWindow flags that would hide it without freezing
    // scripts. The window IS going to be on screen briefly. Match the
    // chrome style Readest's main/reader windows use so it doesn't read
    // as a foreign popup: on macOS the standard window frame with an
    // overlay (transparent) title bar; on other desktops, decorationless
    // with a drop shadow. The loading overlay (injected via initialization
    // script) covers the article render so the user sees a deliberate
    // "Saving…" state rather than the article flashing by.
    let capture_port = port;
    let capture_token = token.clone();
    let navigation_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let navigation_count_for_handler = navigation_count.clone();
    let win_builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(options.window_title())
        .visible(true)
        .center()
        .resizable(false)
        .inner_size(640.0, 480.0)
        .user_agent(BROWSER_UA)
        .initialization_script(fingerprint_mask_script())
        .initialization_script(loading_overlay_script(
            options.overlay_title(),
            options.loading_status(),
            options.background(),
            options.foreground(),
        ))
        .initialization_script(&init_script)
        .on_navigation(move |target| {
            let is_capture_callback = target.scheme() == "http"
                && target.host_str() == Some("127.0.0.1")
                && target.port() == Some(capture_port)
                && target.path() == format!("/clip/{capture_token}");
            if is_capture_callback {
                return true;
            }
            let count =
                navigation_count_for_handler.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if count >= MAX_CLIP_NAVIGATIONS {
                log::warn!("clip_url: rejected excessive navigation to {target}");
                return false;
            }
            match validate_public_target_blocking(target) {
                Ok(()) => true,
                Err(error) => {
                    log::warn!("clip_url: rejected navigation to {target}: {error}");
                    false
                }
            }
        });

    // Tint the window's native background to the caller's theme `bg` so
    // the brief flash before the loading overlay attaches (and any sliver
    // around the WKWebView during resize/inset adjustments) matches the
    // main window's palette instead of flashing white.
    let win_builder = if let Some((r, g, b)) = parse_hex_color(options.background()) {
        win_builder.background_color(tauri::window::Color(r, g, b, 255))
    } else {
        win_builder
    };

    #[cfg(target_os = "macos")]
    let win_builder = win_builder
        .decorations(true)
        .title_bar_style(TitleBarStyle::Overlay);

    #[cfg(all(not(target_os = "macos"), desktop))]
    let win_builder = win_builder.decorations(false).shadow(true);

    let webview_result = win_builder.build();

    let webview = match webview_result {
        Ok(w) => w,
        Err(e) => return Err(format!("Could not create clip webview: {}", e)),
    };

    // 30 s covers a slow page load and a Cloudflare-style JS challenge
    // (5–15 s on bad networks) with margin for the settle delay.
    let result = tokio::time::timeout(Duration::from_secs(30), rx).await;

    // Always close the clip window after capture (or timeout) — the
    // window flashing on screen for a few seconds is the brief mode
    // we want, not a lingering "Saving…" window the user has to close
    // themselves.
    let _ = webview.close();

    match result {
        Ok(Ok(Ok(html))) => Ok(html),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_)) => Err("Webview closed before capture".into()),
        Err(_) => Err("Page took too long to load".into()),
    }
}

/// Mobile clip path. iOS / Android can't spawn a separate
/// `WebviewWindow` and have no equivalent localhost-listener escape
/// hatch, so we hand the URL off to the native-bridge plugin which
/// presents a full-screen `WKWebView` / `WebView`, runs the same Chrome-
/// UA / fingerprint-mask / loading-overlay shape as the desktop flow,
/// captures `document.documentElement.outerHTML` via the platform's
/// `evaluateJavaScript`, and returns it back through the Tauri IPC.
///
/// The JS surface stays identical: `invoke('clip_url', { url, options })`
/// returns the rendered HTML on both desktop and mobile.
#[cfg(mobile)]
#[tauri::command]
pub async fn clip_url(
    app: AppHandle,
    caller: WebviewWindow,
    url: String,
    options: Option<ClipOptions>,
) -> Result<String, String> {
    use tauri_plugin_native_bridge::{ClipUrlRequest, NativeBridgeExt};

    ensure_trusted_clip_caller(&caller)?;
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    validate_public_target(&parsed).await?;
    let options = options.unwrap_or_default();
    let request = ClipUrlRequest {
        url: parsed.to_string(),
        window_title: options.window_title,
        overlay_title: options.overlay_title,
        loading_status: options.loading_status,
        capturing_status: options.capturing_status,
        saved_title: options.saved_title,
        background: options.background,
        foreground: options.foreground,
        interactive: options.interactive,
        sign_in_hint: options.sign_in_hint,
        capture_label: options.capture_label,
        cancel_label: options.cancel_label,
    };
    app.native_bridge()
        .clip_url(request)
        .map(|r| r.html)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod security_tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn rejects_local_private_link_local_and_metadata_addresses() {
        for address in [
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3)),
            IpAddr::V4(Ipv4Addr::new(172, 16, 2, 3)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 2, 3)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
            IpAddr::V4(Ipv4Addr::new(100, 100, 100, 200)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            IpAddr::V6("fe80::1".parse().unwrap()),
            IpAddr::V6("fd00::1".parse().unwrap()),
            IpAddr::V6("::ffff:127.0.0.1".parse().unwrap()),
        ] {
            assert!(is_forbidden_target_ip(address), "{address} must be blocked");
        }
        assert!(!is_forbidden_target_ip(IpAddr::V4(Ipv4Addr::new(
            93, 184, 216, 34
        ))));
        assert!(!is_forbidden_target_ip(IpAddr::V6(
            "2606:2800:220:1:248:1893:25c8:1946".parse().unwrap()
        )));
    }

    #[test]
    fn rejects_a_dns_answer_set_if_any_address_is_not_public() {
        let target = url("https://example.com/article");
        let public = IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34));
        let rebound = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        assert!(validate_resolved_target(&target, &[public]).is_ok());
        assert!(validate_resolved_target(&target, &[public, rebound]).is_err());
    }

    #[test]
    fn every_redirect_target_is_revalidated_after_dns_changes() {
        let public = IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34));
        let private = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10));
        assert!(validate_resolved_target(&url("https://public.example/start"), &[public]).is_ok());
        assert!(
            validate_resolved_target(&url("https://redirected.example/admin"), &[private],)
                .is_err()
        );
    }

    #[tokio::test]
    async fn literal_public_targets_are_allowed_and_literal_local_targets_are_blocked() {
        assert!(
            validate_public_target(&url("https://93.184.216.34/article"))
                .await
                .is_ok()
        );
        for target in [
            "http://127.0.0.1/admin",
            "http://[::1]/admin",
            "http://10.0.0.1/admin",
            "http://169.254.169.254/latest/meta-data",
        ] {
            assert!(
                validate_public_target(&url(target)).await.is_err(),
                "{target}"
            );
        }
    }

    #[test]
    fn rejects_non_http_credentials_and_localhost_names_before_loading() {
        assert!(validate_resolved_target(&url("file:///etc/passwd"), &[]).is_err());
        assert!(validate_resolved_target(
            &url("https://user:secret@example.com/article"),
            &[IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))],
        )
        .is_err());
        assert!(validate_resolved_target(
            &url("http://localhost/admin"),
            &[IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))],
        )
        .is_err());
    }

    #[test]
    fn only_trusted_app_windows_can_invoke_clip_url() {
        for (label, caller) in [
            ("main", "tauri://localhost/send"),
            ("main", "http://tauri.localhost/send"),
            ("reader-42", "http://tauri.localhost/readest/reader"),
            ("moke-home-1", "http://localhost:3001/library"),
        ] {
            assert!(
                is_trusted_clip_caller(label, &url(caller)),
                "{label} {caller}"
            );
        }
        for (label, caller) in [
            ("clip-attacker", "https://example.com"),
            ("reader-42", "https://example.com"),
            ("main", "http://localhost:4444"),
            ("untrusted", "http://tauri.localhost"),
        ] {
            assert!(
                !is_trusted_clip_caller(label, &url(caller)),
                "{label} {caller}"
            );
        }
    }

    #[test]
    fn capture_decoder_rejects_html_over_the_limit() {
        use base64::Engine as _;
        let encoded =
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(vec![b'a'; MAX_CAPTURE_HTML_BYTES + 1]);
        assert!(decode_b64(&encoded).is_none());
    }

    #[test]
    fn mobile_controllers_recheck_main_frame_redirects_and_capture_size() {
        let android = include_str!(
            "../plugins/tauri-plugin-native-bridge/android/src/main/java/ClipUrlController.kt"
        );
        assert!(android.contains("shouldOverrideUrlLoading"));
        assert!(android.contains("isPublicHttpUrl(target)"));
        assert!(android.contains("MAX_CAPTURE_HTML_BYTES"));

        let ios = include_str!(
            "../plugins/tauri-plugin-native-bridge/ios/Sources/ClipUrlController.swift"
        );
        assert!(ios.contains("decidePolicyFor navigationAction"));
        assert!(ios.contains("isPublicHttpUrl(target)"));
        assert!(ios.contains("maxCaptureHtmlBytes"));
    }
}
