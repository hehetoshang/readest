use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=../extensions/windows-thumbnail/src");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        build_windows_thumbnail();
    }

    // The desktop capability file references the reader's desktop-only
    // plugins (e.g. dialog). Tauri scans every matching capability file at
    // build time, so point OHOS builds at the deliberately small, mobile-safe
    // capability file instead of merely selecting it in tauri.ohos.conf.json.
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("ohos") {
        println!("cargo:rerun-if-changed=capabilities/ohos.json");
        tauri_build::try_build(
            tauri_build::Attributes::new().capabilities_path_pattern("capabilities/ohos.json"),
        )
        .expect("failed to build OpenHarmony Tauri assets");
    } else {
        tauri_build::build();
    }
}

fn build_windows_thumbnail() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dll_crate_dir = manifest_dir
        .join("..")
        .join("extensions")
        .join("windows-thumbnail");
    let dll_crate_manifest = dll_crate_dir.join("Cargo.toml");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());

    let mut cmd = Command::new(env::var("CARGO").unwrap_or("cargo".into()));
    cmd.arg("build")
        .arg("--package")
        .arg("windows_thumbnail")
        .arg("--manifest-path")
        .arg(&dll_crate_manifest);

    if profile == "release" {
        cmd.arg("--release");
    }

    let target_triple = env::var("TARGET").unwrap_or_default();
    let host_triple = env::var("HOST").unwrap_or_default();
    if !target_triple.is_empty() && target_triple != host_triple {
        cmd.arg("--target").arg(&target_triple);
    }

    let status = cmd
        .status()
        .expect("Failed to run cargo build for windows_thumbnail");
    if !status.success() {
        panic!("Failed to build windows_thumbnail DLL");
    }

    let dll_name = "windows_thumbnail.dll";
    let candidate_paths = [
        dll_crate_dir.join("target").join(&profile).join(dll_name),
        dll_crate_dir
            .join("target")
            .join(&target_triple)
            .join(&profile)
            .join(dll_name),
    ];

    let dll_src = candidate_paths
        .iter()
        .find(|p| p.exists())
        .expect("Failed to find built windows_thumbnail DLL");

    let dll_dest = &dll_crate_dir.join("target").join(dll_name);

    fs::copy(dll_src, dll_dest).expect("Failed to copy windows_thumbnail DLL");
    println!("cargo:rerun-if-changed={}", dll_dest.display());
}
