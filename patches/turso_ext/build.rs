fn main() {
    // Vendored from crates.io 0.6.1: the upstream build script used
    // `cfg!(target_os = "windows")`, which evaluates on the *host*, so
    // cross-compiling from a Windows host for x86_64-unknown-linux-ohos
    // wrongly linked advapi32 (a Windows-only lib). Read the target from
    // the environment instead, which is what the cfg! in a build script
    // cannot tell you.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }
}
