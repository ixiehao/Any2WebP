use crate::{run_process, worker, AppResult};
use serde::Serialize;
use std::{
    collections::HashSet,
    env, fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Command,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
};

const PREFIXES: [&str; 2] = if cfg!(target_arch = "aarch64") {
    ["/opt/homebrew", "/usr/local"]
} else {
    ["/usr/local", "/opt/homebrew"]
};

static VERIFIED: Mutex<Option<Verified>> = Mutex::new(None);
static INSTALLING: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Tools([ToolFile; 2]);

impl Tools {
    pub(crate) fn ffmpeg(&self) -> &Path {
        &self.0[0].path
    }

    pub(crate) fn ffprobe(&self) -> &Path {
        &self.0[1].path
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ToolFile {
    path: PathBuf,
    inode: u64,
    device: u64,
    modified: (i64, i64),
    changed: (i64, i64),
    size: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Issue {
    Missing,
    Incomplete,
    Unusable,
    Cancelled,
}

impl Issue {
    fn error(self) -> &'static str {
        match self {
            Self::Missing => "ui:ffmpegMissing",
            Self::Incomplete => "ui:ffmpegIncomplete",
            Self::Unusable => "ui:ffmpegUnusable",
            Self::Cancelled => "ui:cancelled",
        }
    }

    fn status(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Incomplete => "incomplete",
            Self::Unusable | Self::Cancelled => "unusable",
        }
    }
}

fn executable(path: &Path) -> Option<fs::Metadata> {
    let meta = fs::metadata(path).ok()?;
    (meta.is_file() && meta.permissions().mode() & 0o111 != 0).then_some(meta)
}

impl ToolFile {
    fn locate(path: &Path) -> Result<Self, Issue> {
        let path = path.canonicalize().map_err(|_| Issue::Unusable)?;
        let meta = executable(&path).ok_or(Issue::Unusable)?;
        Ok(Self {
            path,
            inode: meta.ino(),
            device: meta.dev(),
            modified: (meta.mtime(), meta.mtime_nsec()),
            changed: (meta.ctime(), meta.ctime_nsec()),
            size: meta.len(),
        })
    }
}

fn pair(directory: &Path) -> Result<[ToolFile; 2], Issue> {
    let ffmpeg = directory.join("ffmpeg");
    let ffprobe = directory.join("ffprobe");
    match (ffmpeg.symlink_metadata().is_ok(), ffprobe.symlink_metadata().is_ok()) {
        (false, false) => return Err(Issue::Missing),
        (true, true) => {}
        _ => return Err(Issue::Incomplete),
    }
    let ffmpeg = ToolFile::locate(&ffmpeg)?;
    let ffprobe = ToolFile::locate(&ffprobe)?;
    if ffmpeg.path.parent() != ffprobe.path.parent() {
        return Err(Issue::Unusable);
    }
    Ok([ffmpeg, ffprobe])
}

fn version(file: &ToolFile, name: &str, cancel: Option<&AtomicBool>) -> Result<String, Issue> {
    let mut command = Command::new(&file.path);
    command.arg("-version");
    let output = run_process(command, name, 3, cancel).map_err(|error| {
        if error == "ui:cancelled" { Issue::Cancelled } else { Issue::Unusable }
    })?;
    let text = std::str::from_utf8(&output).map_err(|_| Issue::Unusable)?;
    text.lines()
        .next()
        .and_then(|line| line.strip_prefix(name)?.strip_prefix(" version "))
        .and_then(|line| line.split_whitespace().next())
        .filter(|version| version.len() <= 100)
        .map(str::to_owned)
        .ok_or(Issue::Unusable)
}

#[derive(Debug)]
struct Verified {
    directory: PathBuf,
    files: [ToolFile; 2],
    version: String,
}

fn resolve_in(directories: impl IntoIterator<Item = PathBuf>, cancel: Option<&AtomicBool>) -> Result<Verified, Issue> {
    let mut issue = Issue::Missing;
    let mut seen = HashSet::new();
    for directory in directories {
        if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err(Issue::Cancelled);
        }
        let files = match pair(&directory) {
            Ok(files) => files,
            Err(found) => {
                issue = issue.max(found);
                continue;
            }
        };
        if !seen.insert((files[0].path.clone(), files[1].path.clone())) {
            continue;
        }
        let check = (|| {
            let ffmpeg_version = version(&files[0], "ffmpeg", cancel)?;
            if version(&files[1], "ffprobe", cancel)? != ffmpeg_version {
                return Err(Issue::Unusable);
            }
            Ok(Verified { directory, files, version: ffmpeg_version })
        })();
        match check {
            Ok(tools) => return Ok(tools),
            Err(Issue::Cancelled) => return Err(Issue::Cancelled),
            Err(found) => issue = issue.max(found),
        }
    }
    Err(issue)
}

fn directories() -> Vec<PathBuf> {
    let mut dirs: Vec<_> = PREFIXES.into_iter().flat_map(|prefix| {
        let prefix = Path::new(prefix);
        [prefix.join("opt/ffmpeg-full/bin"), prefix.join("opt/ffmpeg/bin"), prefix.join("bin")]
    }).collect();
    dirs.push("/opt/local/bin".into());
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path).filter(|entry| entry.is_absolute()) {
            if !dirs.contains(&directory) {
                dirs.push(directory);
            }
        }
    }
    dirs
}

fn resolve<T>(
    force: bool,
    cancel: Option<&AtomicBool>,
    read: impl FnOnce(Result<&Verified, Issue>) -> T,
) -> T {
    if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return read(Err(Issue::Cancelled));
    }
    if !force {
        let cached = VERIFIED.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(tools) = cached.as_ref() {
            if pair(&tools.directory).is_ok_and(|files| files == tools.files) {
                return read(Ok(tools));
            }
        }
    }
    let resolved = resolve_in(directories(), cancel);
    let mut cached = VERIFIED.lock().unwrap_or_else(|error| error.into_inner());
    match resolved {
        Ok(tools) => {
            let tools = cached.insert(tools);
            read(Ok(tools))
        }
        Err(Issue::Cancelled) => read(Err(Issue::Cancelled)),
        Err(issue) => {
            *cached = None;
            read(Err(issue))
        }
    }
}

pub(crate) fn find_tools(cancel: Option<&AtomicBool>) -> AppResult<Tools> {
    resolve(false, cancel, |result| {
        result.map(|tools| Tools(tools.files.clone())).map_err(|issue| issue.error().into())
    })
}

fn find_brew() -> Option<PathBuf> {
    PREFIXES.into_iter().map(|prefix| Path::new(prefix).join("bin/brew"))
        .find(|path| executable(path).is_some())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    status: &'static str,
    version: Option<String>,
    directory: Option<String>,
    homebrew_available: bool,
}

fn make_report(result: Result<&Verified, Issue>, homebrew_available: bool) -> Report {
    match result {
        Ok(tools) => Report {
            status: "ready",
            version: Some(tools.version.clone()),
            directory: tools.files[0].path.parent().map(|path| path.to_string_lossy().into_owned()),
            homebrew_available,
        },
        Err(issue) => Report { status: issue.status(), version: None, directory: None, homebrew_available },
    }
}

fn report() -> Report {
    let homebrew_available = find_brew().is_some();
    resolve(true, None, |result| make_report(result, homebrew_available))
}

fn install_formula(brew: &Path, run: impl Fn(&Path, &[&str]) -> AppResult<Vec<u8>>) -> AppResult<()> {
    let installed = run(brew, &["list", "--versions", "ffmpeg"]).is_ok_and(|output| {
        String::from_utf8_lossy(&output).lines().any(|line| {
            let mut parts = line.split_whitespace();
            parts.next() == Some("ffmpeg") && parts.next().is_some()
        })
    });
    let action = if installed { "reinstall" } else { "install" };
    run(brew, &[action, "ffmpeg"])
        .map(|_| ())
        .map_err(|error| {
            let detail: String = error.chars().take(700).collect();
            format!("ui:dependencyInstallFailed:{detail}")
        })
}

fn ensure_ready(
    inspect: impl Fn() -> Report,
    brew: impl FnOnce() -> Option<PathBuf>,
    run: impl Fn(&Path, &[&str]) -> AppResult<Vec<u8>>,
) -> AppResult<Report> {
    let current = inspect();
    if current.status == "ready" {
        return Ok(current);
    }
    let brew = brew().ok_or("ui:dependencyNoBrew")?;
    install_formula(&brew, run)?;
    Ok(inspect())
}

#[tauri::command]
pub(crate) async fn check_video_dependencies() -> AppResult<Report> {
    worker(|| Ok(report())).await
}

#[tauri::command]
pub(crate) async fn install_video_dependencies() -> AppResult<Report> {
    worker(|| {
        let _lock = INSTALLING.try_lock().map_err(|_| "ui:dependencyInstalling")?;
        ensure_ready(report, find_brew, |brew, args| {
            let mut command = Command::new(brew);
            command.args(args)
                .env("HOMEBREW_NO_AUTO_UPDATE", "1")
                .env("HOMEBREW_NO_INSTALL_CLEANUP", "1")
                .env("HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK", "1");
            run_process(command, "Homebrew", if args[0] == "list" { 15 } else { 600 }, None)
        })
    }).await
}

#[tauri::command]
pub(crate) async fn open_homebrew() -> AppResult<()> {
    worker(|| {
        let mut command = Command::new("/usr/bin/open");
        command.arg("https://brew.sh/");
        run_process(command, "Homebrew", 10, None).map(|_| ())
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, os::unix::fs::symlink};

    fn script(directory: &Path, name: &str, body: &str) {
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn working_pair(directory: &Path) {
        script(directory, "ffmpeg", "printf 'ffmpeg version 9.1-test\\n'");
        script(directory, "ffprobe", "printf 'ffprobe version 9.1-test\\n'");
    }

    #[test]
    fn distinguishes_absent_partial_and_broken_pairs_and_uses_a_working_fallback() {
        let broken = tempfile::tempdir().unwrap();
        let working = tempfile::tempdir().unwrap();
        let dirs = || [broken.path().to_owned(), working.path().to_owned()];
        assert_eq!(resolve_in(dirs(), None).unwrap_err(), Issue::Missing);
        script(broken.path(), "ffmpeg", "exit 12");
        assert_eq!(resolve_in(dirs(), None).unwrap_err(), Issue::Incomplete);
        script(broken.path(), "ffprobe", "printf 'ffprobe version 9.1-test\\n'");
        assert_eq!(resolve_in(dirs(), None).unwrap_err(), Issue::Unusable);
        working_pair(working.path());
        let selected = resolve_in(dirs(), None).unwrap();
        assert_eq!(selected.directory, working.path());
        assert_eq!(selected.version, "9.1-test");
    }

    #[test]
    fn rejects_mismatched_installations_even_when_linked_from_one_directory() {
        let directory = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        script(directory.path(), "ffmpeg", "printf 'ffmpeg version 9.1-test\\n'");
        script(other.path(), "ffprobe", "printf 'ffprobe version 9.1-test\\n'");
        symlink(other.path().join("ffprobe"), directory.path().join("ffprobe")).unwrap();
        assert_eq!(resolve_in([directory.path().to_owned()], None).unwrap_err(), Issue::Unusable);
        fs::remove_file(directory.path().join("ffprobe")).unwrap();
        script(directory.path(), "ffprobe", "printf 'ffprobe version 8.0-test\\n'");
        assert_eq!(resolve_in([directory.path().to_owned()], None).unwrap_err(), Issue::Unusable);
    }

    #[test]
    fn explicit_install_and_repair_run_fixed_arguments_and_require_a_usable_pair() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path();
        let inspect = || match resolve_in([directory.to_owned()], None) {
            Ok(tools) => make_report(Ok(&tools), true),
            Err(issue) => make_report(Err(issue), true),
        };
        let brew = directory.join("brew");
        let log = RefCell::new(Vec::new());
        let run = |exe: &Path, argv: &[&str]| {
            assert_eq!(exe, brew);
            log.borrow_mut().push(argv.join(" "));
            match argv {
                ["list", "--versions", "ffmpeg"] => Err("no installed formula".into()),
                ["install", "ffmpeg"] => Ok(vec![]),
                _ => panic!("unknown args: {argv:?}"),
            }
        };
        let result = ensure_ready(inspect, || Some(brew.clone()), run).unwrap();
        assert_eq!(result.status, "missing");
        assert_eq!(*log.borrow(), ["list --versions ffmpeg", "install ffmpeg"]);

        let log = RefCell::new(Vec::new());
        let result = ensure_ready(inspect, || Some(brew.clone()), |_, argv| {
            log.borrow_mut().push(argv.join(" "));
            if argv[0] == "list" {
                return Ok(b"ffmpeg 9.0.2\n".to_vec());
            }
            assert_eq!(argv, ["reinstall", "ffmpeg"]);
            working_pair(directory);
            Ok(vec![])
        }).unwrap();
        assert_eq!(result.status, "ready");
        assert_eq!(*log.borrow(), ["list --versions ffmpeg", "reinstall ffmpeg"]);
        assert_eq!(ensure_ready(inspect, || panic!("already ready"), |_, _| panic!("already ready")).unwrap().status, "ready");
    }

    #[test]
    fn missing_homebrew_and_install_failure_are_reported_separately() {
        let inspect = || make_report(Err(Issue::Missing), false);
        let result = ensure_ready(inspect, || None, |_, _| panic!("Homebrew missing"));
        assert_eq!(result.err().unwrap(), "ui:dependencyNoBrew");
        let result = ensure_ready(inspect, || Some("/tmp/brew".into()), |_, args| {
            if args[0] == "list" { Ok(vec![]) } else { Err("network unavailable".into()) }
        });
        assert_eq!(result.err().unwrap(), "ui:dependencyInstallFailed:network unavailable");
    }
}
