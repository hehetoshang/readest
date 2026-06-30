#[cfg(target_os = "macos")]
#[macro_use]
extern crate cocoa;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "android")]
mod android;

use tauri::utils::config::BackgroundThrottlingPolicy;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

#[cfg(desktop)]
use tauri::{Listener, Url};
mod clip_url;
mod dir_scanner;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod discord_rpc;
mod epub_parser;
#[cfg(target_os = "macos")]
mod macos;
mod mobi_parser;
mod parser_common;
mod range_file;
mod transfer_file;
#[cfg(desktop)]
mod window_state;
#[cfg(target_os = "windows")]
use tauri::webview::ScrollBarStyle;
use tauri::{command, Emitter, WebviewUrl, WebviewWindowBuilder, Window};
#[cfg(target_os = "android")]
use tauri_plugin_native_bridge::register_select_directory_callback;
#[cfg(target_os = "android")]
use tauri_plugin_native_bridge::{NativeBridgeExt, OpenExternalUrlRequest};
use tauri_plugin_oauth::start;
#[cfg(not(target_os = "android"))]
use tauri_plugin_opener::OpenerExt;
use transfer_file::{download_file, upload_file};

#[cfg(any(desktop, target_os = "ios"))]
fn allow_file_in_scopes(app: &AppHandle, files: Vec<PathBuf>) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    for file in &files {
        if let Err(e) = fs_scope.allow_file(file) {
            log::error!("Failed to allow file in fs_scope: {e}");
        } else {
            log::debug!("Allowed file in fs_scope: {file:?}");
        }
        if let Err(e) = asset_protocol_scope.allow_file(file) {
            log::error!("Failed to allow file in asset_protocol_scope: {e}");
        } else {
            log::debug!("Allowed file in asset_protocol_scope: {file:?}");
        }
    }
}

fn allow_dir_in_scopes(app: &AppHandle, dir: &PathBuf) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    if let Err(e) = fs_scope.allow_directory(dir, true) {
        log::error!("Failed to allow directory in fs_scope: {e}");
    } else {
        log::info!("Allowed directory in fs_scope: {dir:?}");
    }
    if let Err(e) = asset_protocol_scope.allow_directory(dir, true) {
        log::error!("Failed to allow directory in asset_protocol_scope: {e}");
    } else {
        log::info!("Allowed directory in asset_protocol_scope: {dir:?}");
    }
}

/// Frontend-callable shim around [`allow_file_in_scopes`] /
/// [`allow_dir_in_scopes`]. Used after dialog-based file/folder pickers
/// because the Tauri `dialog` plugin only auto-grants `fs_scope`, not
/// `asset_protocol_scope` — and our importer relies on the asset
/// protocol (`RemoteFile`) to read user-selected files. Without this,
/// importing a book from e.g. `~/Downloads/...` fails with
/// "asset protocol not configured to allow the path".
///
/// Granted scopes are persisted across app restarts thanks to
/// `tauri_plugin_persisted_scope`, so re-picking the same file isn't
/// required after the first allow call.
///
/// Security:
///
///   - On desktop, this command refuses to extend `asset_protocol_scope`
///     for any path that is not already allowed in `fs_scope`. The
///     `fs_scope` there is populated only by the Tauri `dialog` plugin
///     (when the user picks through the OS picker) or by
///     `tauri_plugin_persisted_scope` (which restores prior dialog
///     grants on startup). That gate constrains the command to
///     user-selected paths only — otherwise any frontend code
///     (including a future XSS via book content, OPDS HTML, dictionary
///     lookups, or a compromised dependency) could invoke it with an
///     arbitrary path like `/` or `~/.ssh` and gain persistent read
///     access to the entire user home directory via the asset
///     protocol.
///
///   - On iOS, the `fs_scope` gate is intentionally skipped: the iOS
///     directory/file picker (`UIDocumentPickerViewController`) does
///     not flow through Tauri's dialog plugin, and we keep the only
///     persistent record of user-authorised paths inside the
///     native-bridge plugin's security-scoped bookmark store
///     (`FolderBookmarkStore` in NativeBridgePlugin.swift). The
///     OS sandbox itself is the access-control boundary: the process
///     can only read paths for which it holds a security-scoped
///     resource (granted by the system picker, persisted via
///     bookmark). Widening Tauri's `fs_scope`/`asset_protocol_scope`
///     to those same paths cannot escalate access beyond what the OS
///     already grants — it just lets the fs / dir-scanner layers
///     route reads through the path the WebView gave them. The
///     frontend layer also keeps the list of folder roots in
///     `settings.externalLibraryFolders` and re-issues this call on
///     every launch, so the in-memory scope set stays in sync with
///     the user's persisted intent.
#[command]
fn allow_paths_in_scopes(_app: AppHandle, _paths: Vec<String>, _is_directory: bool) {
    #[cfg(desktop)]
    {
        let fs_scope = _app.fs_scope();
        for raw in _paths {
            if raw.is_empty() {
                continue;
            }
            let path = PathBuf::from(&raw);
            if !fs_scope.is_allowed(&path) {
                log::warn!("allow_paths_in_scopes refused (path not in fs_scope): {path:?}");
                continue;
            }
            if _is_directory {
                allow_dir_in_scopes(&_app, &path);
            } else {
                allow_file_in_scopes(&_app, vec![path]);
            }
        }
    }
    #[cfg(target_os = "ios")]
    {
        // The iOS picker hands us a security-scoped URL whose POSIX
        // path lives outside any of our static fs_scope globs (e.g.
        // File Provider Storage, iCloud Drive, third-party providers).
        // Without explicitly widening fs_scope/asset_protocol_scope
        // here, both `dir_scanner::read_dir` and the fs plugin's
        // `readDir` would reject the path even though the OS sandbox
        // already grants us access via the held security-scoped
        // resource. See the security comment above.
        for raw in _paths {
            if raw.is_empty() {
                continue;
            }
            let path = PathBuf::from(&raw);
            if _is_directory {
                allow_dir_in_scopes(&_app, &path);
            } else {
                allow_file_in_scopes(&_app, vec![path]);
            }
        }
    }
    #[cfg(target_os = "android")]
    {
        // Android picker already routes through register_select_directory_callback
        // for directories; files go through SAF / content-URIs and don't use
        // asset_protocol_scope. Nothing to do here.
    }
}

#[cfg(desktop)]
fn get_files_from_argv(argv: Vec<String>) -> Vec<PathBuf> {
    let mut files = Vec::new();
    // NOTICE: `args` may include URL protocol (`your-app-protocol://`)
    // or arguments (`--`) if your app supports them.
    // files may also be passed as `file://path/to/file`
    for (_, maybe_file) in argv.iter().enumerate().skip(1) {
        // skip flags like -f or --flag
        if maybe_file.starts_with("-") {
            continue;
        }
        // handle `file://` path urls and skip other urls
        if let Ok(url) = Url::parse(maybe_file) {
            if let Ok(path) = url.to_file_path() {
                files.push(path);
            } else {
                files.push(PathBuf::from(maybe_file))
            }
        } else {
            files.push(PathBuf::from(maybe_file))
        }
    }
    files
}

#[cfg(desktop)]
fn set_window_open_with_files(app: &AppHandle, files: Vec<PathBuf>) {
    let files = files
        .into_iter()
        .map(|f| {
            let file = f
                .to_string_lossy()
                .replace("\\", "\\\\")
                .replace("\"", "\\\"");
            format!("\"{file}\"",)
        })
        .collect::<Vec<_>>()
        .join(",");
    let window = app.get_webview_window("main").unwrap();
    let script = format!("window.OPEN_WITH_FILES = [{files}];");
    if let Err(e) = window.eval(&script) {
        eprintln!("Failed to set open files variable: {e}");
    }
}

#[command]
async fn start_server(window: Window) -> Result<u16, String> {
    start(move |url| {
        // Because of the unprotected localhost port, you must verify the URL here.
        // Preferebly send back only the token, or nothing at all if you can handle everything else in Rust.
        let _ = window.emit("redirect_uri", url);
    })
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn get_environment_variable(name: &str) -> String {
    std::env::var(String::from(name)).unwrap_or(String::from(""))
}

#[tauri::command]
fn get_executable_dir() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[derive(Clone, serde::Serialize)]
#[allow(dead_code)]
struct SingleInstancePayload {
    args: Vec<String>,
    cwd: String,
}

/// Register the reader (readest) backend plugins onto an existing Tauri
/// builder. This is the integration entry point used when readest is embedded
/// in a host app (Moke) instead of running standalone.
///
/// The host owns the base plugins it also needs on its own
/// (`fs`, `http`, `os`, `shell`, `opener`), so they are intentionally NOT
/// registered here — registering a plugin twice panics. This adds only the
/// extra plugins the reader frontend relies on.
pub fn register_reader_plugins(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tracing", log::LevelFilter::Warn)
                .level_for("tantivy", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_device_info::init())
        .plugin(tauri_plugin_turso::init())
        .plugin(tauri_plugin_native_bridge::init())
        .plugin(tauri_plugin_native_tts::init())
}

/// Manage reader-related app state (currently the Discord Rich Presence
/// client). Call once from the host app's `setup`.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub fn manage_reader_state(app: &AppHandle) {
    use std::sync::{Arc, Mutex};
    let discord_client = Arc::new(Mutex::new(discord_rpc::DiscordRpcClient::new()));
    app.manage(discord_client);
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn manage_reader_state(_app: &AppHandle) {}

/// Open a reader window that loads the embedded readest frontend (served by
/// the host app under `/readest`). The book to open is handed to the frontend
/// via `window.OPEN_WITH_FILES`, matching readest's standalone file-open path.
///
/// Each call creates a fresh `reader-<n>` window; the label prefix matches the
/// `reader-*` capability pattern so the window inherits the right permissions.
#[cfg(desktop)]
pub fn open_reader_window(app: &AppHandle, file: Option<PathBuf>) -> Result<(), String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static READER_SEQ: AtomicUsize = AtomicUsize::new(0);

    if let Some(ref f) = file {
        allow_file_in_scopes(app, vec![f.clone()]);
    }

    let files_js = match &file {
        Some(f) => {
            let s = f
                .to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"");
            format!("[\"{s}\"]")
        }
        None => "[]".to_string(),
    };

    let init_script = format!(
        r#"
            window.OPEN_WITH_FILES = {files_js};
            window.__MOKE_EMBEDDED = true;
            window.addEventListener('DOMContentLoaded', function() {{
                document.documentElement.classList.add('edge-to-edge');
            }});
        "#
    );

    let n = READER_SEQ.fetch_add(1, Ordering::Relaxed);
    let label = format!("reader-{n}");

    // WebView2 (Windows) must be created on the main/UI thread. `open_reader`
    // is an async command (worker thread), and building the webview off the
    // main thread fails with HRESULT 0x8007139F (ERROR_INVALID_STATE). Post the
    // creation to the main thread, fire-and-forget, so we never block or
    // deadlock the IPC caller; any failure is logged. Kept to a plain window
    // (native decorations, no transparency/custom scrollbar) for maximum
    // compatibility — chrome can be refined once it opens reliably.
    let app_main = app.clone();
    app.run_on_main_thread(move || {
        let result = WebviewWindowBuilder::new(
            &app_main,
            label,
            WebviewUrl::App("readest/index.html".into()),
        )
        .title("Readest")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .initialization_script(&init_script)
        .build();
        if let Err(e) = result {
            log::error!("failed to open reader window: {e}");
        }
    })
    .map_err(|e| e.to_string())
}

/// Frontend entry command for the embedded host (Moke). Mirrors the host's
/// previous `open_reader` contract (`invoke('open_reader', { filePath })`) but
/// now opens an in-process reader window instead of spawning a separate exe.
#[cfg(desktop)]
#[tauri::command]
async fn open_reader(app: AppHandle, file_path: String) -> Result<(), String> {
    open_reader_window(&app, Some(PathBuf::from(file_path)))
}

/// The full app-level invoke handler for the reader backend, exposed so an
/// embedding host (Moke) can install it with a single
/// `.invoke_handler(readestlib::reader_invoke_handler())`.
///
/// The reader frontend calls these commands by bare name (e.g.
/// `invoke('parse_epub_full')`), so they must live on the app-level handler,
/// not behind a plugin namespace. Building the handler here (inside the crate
/// that defines the commands) keeps the command macros in scope and avoids the
/// crate-root `pub fn` re-export collision that arises when listing them from
/// another crate.
pub fn reader_invoke_handler(
) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        #[cfg(desktop)]
        open_reader,
        start_server,
        download_file,
        upload_file,
        get_environment_variable,
        get_executable_dir,
        allow_paths_in_scopes,
        dir_scanner::read_dir,
        epub_parser::parse_epub_metadata,
        epub_parser::extract_epub_cover_full,
        epub_parser::parse_epub_full,
        mobi_parser::parse_mobi_metadata,
        mobi_parser::extract_mobi_cover_full,
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        discord_rpc::update_book_presence,
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        discord_rpc::clear_book_presence,
        clip_url::clip_url,
    ]
}

#[cfg(feature = "standalone")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tracing", log::LevelFilter::Warn)
                .level_for("tantivy", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init())
        .invoke_handler(tauri::generate_handler![
            start_server,
            download_file,
            upload_file,
            get_environment_variable,
            get_executable_dir,
            allow_paths_in_scopes,
            dir_scanner::read_dir,
            epub_parser::parse_epub_metadata,
            epub_parser::extract_epub_cover_full,
            epub_parser::parse_epub_full,
            mobi_parser::parse_mobi_metadata,
            mobi_parser::extract_mobi_cover_full,
            #[cfg(target_os = "macos")]
            macos::safari_auth::auth_with_safari,
            #[cfg(target_os = "macos")]
            macos::apple_auth::start_apple_sign_in,
            #[cfg(target_os = "macos")]
            macos::traffic_light::set_traffic_lights,
            #[cfg(target_os = "macos")]
            macos::system_dictionary::show_lookup_popover,
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            discord_rpc::update_book_presence,
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            discord_rpc::clear_book_presence,
            clip_url::clip_url,
        ])
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_device_info::init())
        .plugin(tauri_plugin_turso::init())
        .plugin(tauri_plugin_native_bridge::init())
        .plugin(tauri_plugin_native_tts::init())
        .plugin(tauri_plugin_webview_upgrade::init())
        // Serves local file byte-ranges to `RemoteFile` via `?path=&start=&end=`
        // (range-in-URL, not a `Range` header) so Android's WebView doesn't
        // re-apply the offset. Scope-gated by `asset_protocol_scope`.
        .register_asynchronous_uri_scheme_protocol(range_file::SCHEME, range_file::handle);

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_single_instance::Builder::new()
            .callback(move |app, argv, cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
                let files = get_files_from_argv(argv.clone());
                if !files.is_empty() {
                    allow_file_in_scopes(app, files.clone());
                }
                app.emit("single-instance", SingleInstancePayload { args: argv, cwd })
                    .unwrap();
            })
            .dbus_id("com.bilingify.readest".to_owned())
            .build(),
    );

    let builder = builder.plugin(tauri_plugin_deep_link::init());

    // 更新系统已移除：不再注册 tauri_plugin_updater。

    // Strip invalid geometry from the saved window state before the
    // window-state plugin loads it, so a bad `.window-state.json` (e.g. the
    // Windows minimized `-32000` sentinel) can't crash WebView2 on launch.
    // See https://github.com/readest/readest/issues/4398.
    #[cfg(desktop)]
    let builder = builder.plugin(window_state::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(macos::traffic_light::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(macos::safari_auth::init());

    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_sign_in_with_apple::init());

    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        .setup(|#[allow(unused_variables)] app| {
            // When running with the webdriver feature (E2E/integration tests),
            // grant all default permissions to remote URLs (http://127.0.0.1:*)
            // so that Vitest browser-mode tests can call plugin commands.
            #[cfg(feature = "webdriver")]
            {
                use tauri::Manager;
                app.add_capability(include_str!("../capabilities-extra/webdriver.json"))?;
            }
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                use std::sync::{Arc, Mutex};
                let discord_client = Arc::new(Mutex::new(discord_rpc::DiscordRpcClient::new()));
                app.manage(discord_client);
            }

            #[cfg(desktop)]
            {
                let files = get_files_from_argv(std::env::args().collect());
                if !files.is_empty() {
                    let app_handle = app.handle().clone();
                    allow_file_in_scopes(&app_handle, files.clone());
                    app.listen("window-ready", move |_| {
                        println!("Window is ready, proceeding to handle files.");
                        set_window_open_with_files(&app_handle, files.clone());
                    });
                }
            }

            #[cfg(desktop)]
            {
                allow_dir_in_scopes(app.handle(), &PathBuf::from(get_executable_dir()));
            }

            #[cfg(target_os = "android")]
            register_select_directory_callback(app.handle(), move |app, path| {
                allow_dir_in_scopes(app, path);
            });

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_cli::init())?;
            }

            // Check for e-ink device on Android before building the window
            #[cfg(target_os = "android")]
            let is_eink = android::is_eink_device();
            #[cfg(not(target_os = "android"))]
            let is_eink = false;

            #[cfg(desktop)]
            let cli_access = true;
            #[cfg(not(desktop))]
            let cli_access = false;

            #[cfg(target_os = "linux")]
            let is_appimage = std::env::var("APPIMAGE").is_ok()
                || std::env::current_exe()
                    .map(|path| path.to_string_lossy().contains("/tmp/.mount_"))
                    .unwrap_or(false);
            #[cfg(not(target_os = "linux"))]
            let is_appimage = false;

            // Flatpak mounts the app directory read-only, so the bundled updater can
            // download but never apply an update. Disable it and leave updates to the
            // Flatpak runtime. Detect via FLATPAK_ID or the /.flatpak-info sandbox file.
            #[cfg(desktop)]
            let updater_disabled = {
                #[cfg(target_os = "linux")]
                let is_flatpak = std::env::var("FLATPAK_ID").is_ok()
                    || std::path::Path::new("/.flatpak-info").exists();
                #[cfg(not(target_os = "linux"))]
                let is_flatpak = false;
                std::env::var("READEST_DISABLE_UPDATER").is_ok() || is_flatpak
            };
            #[cfg(not(desktop))]
            let updater_disabled = false;

            let init_script = format!(
                r#"
                    if ({is_eink}) window.__READEST_IS_EINK = true;
                    if ({cli_access}) window.__READEST_CLI_ACCESS = true;
                    if ({is_appimage}) window.__READEST_IS_APPIMAGE = true;
                    if ({updater_disabled}) window.__READEST_UPDATER_DISABLED = true;
                    window.addEventListener('DOMContentLoaded', function() {{
                        document.documentElement.classList.add('edge-to-edge');
                        const isTauriLocal = window.location.protocol === 'tauri:' ||
                                            window.location.protocol === 'about:' ||
                                            window.location.hostname === 'tauri.localhost';
                        const needsSafeArea = !isTauriLocal;
                        if (needsSafeArea && !document.getElementById('safe-area-style')) {{
                            const style = document.createElement('style');
                            style.id = 'safe-area-style';
                            style.textContent = `
                                body {{
                                    padding-top: env(safe-area-inset-top) !important;
                                    padding-bottom: env(safe-area-inset-bottom) !important;
                                    padding-left: env(safe-area-inset-left) !important;
                                    padding-right: env(safe-area-inset-right) !important;
                                }}
                            `;
                            document.head.appendChild(style);
                        }}
                    }});
                "#,
                is_eink = is_eink,
                cli_access = cli_access,
                is_appimage = is_appimage,
                updater_disabled = updater_disabled
            );

            let app_handle = app.handle().clone();
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .background_throttling(BackgroundThrottlingPolicy::Disabled)
                .background_color(if is_eink {
                    tauri::window::Color(255, 255, 255, 255)
                } else {
                    tauri::window::Color(50, 49, 48, 255)
                })
                .initialization_script(&init_script)
                .on_navigation(move |url| {
                    if url.scheme() == "alipays" || url.scheme() == "alipay" {
                        let url_str = url.as_str().to_string();
                        #[cfg(target_os = "android")]
                        {
                            let handle = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                match handle
                                    .native_bridge()
                                    .open_external_url(OpenExternalUrlRequest { url: url_str })
                                {
                                    Ok(result) => println!("Result: {:?}", result),
                                    Err(e) => eprintln!("Error: {:?}", e),
                                }
                            });
                        }
                        #[cfg(not(target_os = "android"))]
                        {
                            let _ = app_handle.opener().open_url(url_str, None::<&str>);
                        }
                        return false;
                    }
                    true
                });

            #[cfg(target_os = "macos")]
            let win_builder = win_builder.inner_size(1280.0, 800.0).resizable(true);
            #[cfg(all(not(target_os = "macos"), desktop))]
            let win_builder = win_builder.inner_size(800.0, 600.0).resizable(true);

            #[cfg(target_os = "macos")]
            let win_builder = win_builder
                .decorations(true)
                .title_bar_style(TitleBarStyle::Overlay)
                .title("");

            #[cfg(all(not(target_os = "macos"), desktop))]
            let win_builder = {
                let mut builder = win_builder
                    .decorations(false)
                    .visible(false)
                    .shadow(true)
                    .title("Readest");

                #[cfg(target_os = "windows")]
                {
                    builder = builder
                        .transparent(false)
                        .scroll_bar_style(ScrollBarStyle::FluentOverlay);
                }
                #[cfg(target_os = "linux")]
                {
                    builder = builder
                        .transparent(true)
                        .background_color(tauri::window::Color(0, 0, 0, 0));
                }

                builder
            };

            #[cfg(not(target_os = "macos"))]
            {
                win_builder.build().unwrap();
            }
            // let win = win_builder.build().unwrap();
            // win.open_devtools();

            #[cfg(target_os = "macos")]
            {
                let window = win_builder.build().unwrap();
                // On macOS, closing a window (via Cmd+W or the red traffic light) should
                // not quit the app — only Cmd+Q should. Hide the window instead so the
                // app keeps running in the dock, and restore it when the user reopens
                // the app from the dock.
                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            #[cfg(target_os = "macos")]
            macos::menu::setup_macos_menu(app.handle())?;

            app.handle().emit("window-ready", ()).unwrap();

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(
            #[allow(unused_variables)]
            |app_handle, event| {
                #[cfg(target_os = "macos")]
                match event {
                    tauri::RunEvent::Opened { urls } => {
                        let files = urls
                            .into_iter()
                            .filter_map(|url| url.to_file_path().ok())
                            .collect::<Vec<_>>();

                        let app_handler_clone = app_handle.clone();
                        allow_file_in_scopes(app_handle, files.clone());
                        app_handle.listen("window-ready", move |_| {
                            println!("Window is ready, proceeding to handle files.");
                            set_window_open_with_files(&app_handler_clone, files.clone());
                        });
                    }
                    // When the user reopens the app from the dock after closing all
                    // windows, re-show the main window instead of leaving the dock
                    // icon inert.
                    tauri::RunEvent::Reopen {
                        has_visible_windows: false,
                        ..
                    } => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                    _ => {}
                }
            },
        );
}
