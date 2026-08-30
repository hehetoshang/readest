use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PathAccess {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthorizedRoots {
    Books,
    AppStorage,
}

const PERMISSION_DENIED: &str = "permission denied: path is outside authorized roots";

/// Resolve a webview-supplied path and require it to be under an anchored app
/// root or an explicit runtime filesystem-scope grant.
pub(crate) fn authorize_path(
    app: &AppHandle,
    raw_path: &str,
    access: PathAccess,
    authorized_roots: AuthorizedRoots,
) -> Result<PathBuf, String> {
    let path = Path::new(raw_path);
    let resolved = resolve_path(path, access).map_err(|_| PERMISSION_DENIED.to_string())?;
    let roots: Vec<PathBuf> = app_roots(app, authorized_roots)
        .into_iter()
        .filter_map(|root| resolve_path(&root, PathAccess::Write).ok())
        .collect();
    authorize_resolved(resolved, &roots, |candidate| {
        app.fs_scope().is_allowed(candidate)
    })
}

fn app_roots(app: &AppHandle, authorized_roots: AuthorizedRoots) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(app_data) = app.path().app_data_dir() {
        match authorized_roots {
            AuthorizedRoots::Books => {
                roots.push(app_data.join("books"));
                roots.push(app_data.join("Readest").join("Books"));
            }
            AuthorizedRoots::AppStorage => {
                roots.push(app_data.join("books"));
                roots.push(app_data.join("Readest"));
            }
        }
    }
    if authorized_roots == AuthorizedRoots::AppStorage {
        if let Ok(app_cache) = app.path().app_cache_dir() {
            roots.push(app_cache);
        }
    }
    roots
}

fn authorize_resolved<F>(
    resolved: PathBuf,
    roots: &[PathBuf],
    scope_allows: F,
) -> Result<PathBuf, String>
where
    F: FnOnce(&Path) -> bool,
{
    let in_anchored_root = roots.iter().any(|root| resolved.starts_with(root));
    if in_anchored_root || scope_allows(&resolved) {
        Ok(resolved)
    } else {
        Err(PERMISSION_DENIED.to_string())
    }
}

fn resolve_path(path: &Path, access: PathAccess) -> io::Result<PathBuf> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path must be absolute and traversal-free",
        ));
    }

    match access {
        PathAccess::Read => fs::canonicalize(path),
        PathAccess::Write => canonicalize_write_target(path),
    }
}

/// Canonicalize an existing target, or (for a new download destination) the
/// nearest existing ancestor before appending the missing components. This
/// resolves parent-directory symlinks without requiring the final file to
/// exist yet.
fn canonicalize_write_target(path: &Path) -> io::Result<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(_) => return fs::canonicalize(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let mut ancestor = path;
    let mut missing = Vec::<OsString>::new();
    loop {
        match fs::symlink_metadata(ancestor) {
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let name = ancestor.file_name().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::NotFound, "no existing path ancestor")
                })?;
                missing.push(name.to_os_string());
                ancestor = ancestor.parent().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::NotFound, "no existing path ancestor")
                })?;
            }
            Err(error) => return Err(error),
        }
    }

    let mut resolved = fs::canonicalize(ancestor)?;
    for component in missing.into_iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::{authorize_resolved, resolve_path, PathAccess};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let sequence = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "readest-path-authorization-{}-{sequence}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn authorize(
        path: &Path,
        access: PathAccess,
        roots: &[PathBuf],
        explicitly_allowed: bool,
    ) -> Result<PathBuf, String> {
        let resolved = resolve_path(path, access).map_err(|error| error.to_string())?;
        let resolved_roots: Vec<PathBuf> = roots
            .iter()
            .map(|root| resolve_path(root, PathAccess::Write).unwrap())
            .collect();
        authorize_resolved(resolved, &resolved_roots, |_| explicitly_allowed)
    }

    #[test]
    fn allows_books_root_and_explicit_scope_only() {
        let temp = TestDir::new();
        let books = temp.path().join("app-data/Readest/Books");
        let external = temp.path().join("picked/book.epub");
        fs::create_dir_all(&books).unwrap();
        fs::create_dir_all(external.parent().unwrap()).unwrap();
        fs::write(books.join("managed.epub"), b"book").unwrap();
        fs::write(&external, b"book").unwrap();

        assert!(authorize(
            &books.join("managed.epub"),
            PathAccess::Read,
            std::slice::from_ref(&books),
            false,
        )
        .is_ok());
        assert!(authorize(&external, PathAccess::Read, &[books.clone()], true).is_ok());
        assert!(authorize(&external, PathAccess::Read, &[books], false).is_err());
    }

    #[test]
    fn same_name_directory_is_not_an_app_root() {
        let temp = TestDir::new();
        let books = temp.path().join("app-data/Readest/Books");
        let lure = temp.path().join("home/Readest/Books/stolen.epub");
        fs::create_dir_all(&books).unwrap();
        fs::create_dir_all(lure.parent().unwrap()).unwrap();
        fs::write(&lure, b"book").unwrap();

        assert!(authorize(&lure, PathAccess::Read, &[books], false).is_err());
    }

    #[test]
    fn rejects_parent_traversal_even_when_it_lands_in_a_root() {
        let temp = TestDir::new();
        let books = temp.path().join("Readest/Books");
        fs::create_dir_all(&books).unwrap();
        let traversal = books.join("child/../new.epub");

        assert!(authorize(&traversal, PathAccess::Write, &[books], false).is_err());
    }

    #[test]
    fn resolves_nonexistent_write_targets_against_the_nearest_existing_parent() {
        let temp = TestDir::new();
        let books = temp.path().join("Readest/Books");
        fs::create_dir_all(&books).unwrap();
        let destination = books.join("new/hash/book.epub");

        let authorized = authorize(
            &destination,
            PathAccess::Write,
            std::slice::from_ref(&books),
            false,
        )
        .unwrap();
        assert!(authorized.ends_with("Readest/Books/new/hash/book.epub"));

        let outside = temp.path().join("Readest-copy/new.epub");
        assert!(authorize(&outside, PathAccess::Write, &[books], false).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn canonicalization_blocks_symlink_escapes_for_reads_and_writes() {
        use std::os::unix::fs::symlink;

        let temp = TestDir::new();
        let books = temp.path().join("Readest/Books");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&books).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.epub"), b"secret").unwrap();
        symlink(&outside, books.join("escape")).unwrap();

        assert!(authorize(
            &books.join("escape/secret.epub"),
            PathAccess::Read,
            &[books.clone()],
            false,
        )
        .is_err());
        assert!(authorize(
            &books.join("escape/new.epub"),
            PathAccess::Write,
            &[books],
            false,
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn windows_separators_do_not_turn_a_relative_path_into_an_absolute_one() {
        assert!(resolve_path(
            Path::new(r"C:\Users\Alice\Readest\Books\book.epub"),
            PathAccess::Read,
        )
        .is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_are_canonicalized_case_insensitively() {
        let temp = TestDir::new();
        let books = temp.path().join("Readest").join("Books");
        fs::create_dir_all(&books).unwrap();
        let book = books.join("book.epub");
        fs::write(&book, b"book").unwrap();

        let upper = PathBuf::from(book.to_string_lossy().to_uppercase());
        assert!(authorize(&upper, PathAccess::Read, &[books], false).is_ok());
    }
}
