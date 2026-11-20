mod adjustment;
mod frames;
mod localized_menu;
mod updates;
mod video;
mod video_tools;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read, Seek, SeekFrom, Write},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Response, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tempfile::NamedTempFile;

type AppResult<T> = Result<T, String>;

const CODEC_TOOL: &str = "Any2WebP codec";

#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum OutputFormat {
    #[default]
    Webp,
    Gif,
}

impl OutputFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Webp => "webp",
            Self::Gif => "gif",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Webp => "WebP",
            Self::Gif => "GIF",
        }
    }

    fn save_error(self) -> &'static str {
        match self {
            Self::Webp => "saveWebp",
            Self::Gif => "saveGif",
        }
    }
}

#[derive(Deserialize, Serialize)]
struct ImageInfo {
    format: String,
    bytes: u64,
    width: u32,
    height: u32,
    animated: bool,
    alpha: bool,
    recovered: bool,
    plays: u32,
    delays: Vec<u32>,
}

#[derive(Deserialize)]
struct CodecResult {
    quality: i32,
    unchanged: bool,
    source: ImageInfo,
    output: ImageInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Conversion {
    source: ImageInfo,
    output: ImageInfo,
    path: String,
    mode: &'static str,
    quality: i32,
    target_met: Option<bool>,
    video_settings: Option<video::Settings>,
    source_revision: String,
    output_revision: String,
}

#[derive(Default)]
struct Job(Mutex<JobState>);

#[derive(Default)]
struct JobState {
    active: Option<(u64, Arc<AtomicBool>)>,
    cancelled_through: u64,
}

impl Job {
    fn begin(&self, id: u64) -> AppResult<Arc<AtomicBool>> {
        let mut state = self.0.lock().map_err(|_| "ui:jobQueueUnavailable")?;
        if id <= state.cancelled_through {
            return Err("ui:cancelled".into());
        }
        if state.active.is_some() {
            return Err("ui:jobBusy".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        state.active = Some((id, Arc::clone(&cancel)));
        Ok(cancel)
    }

    fn finish(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.active = None;
        }
    }

    fn cancel(&self, id: u64) -> AppResult<()> {
        let mut state = self.0.lock().map_err(|_| "ui:jobQueueUnavailable")?;
        state.cancelled_through = state.cancelled_through.max(id);
        if let Some((current, flag)) = &state.active {
            if *current == id {
                flag.store(true, Ordering::Relaxed);
            }
        }
        Ok(())
    }
}

fn local_path(file: FilePath) -> Option<String> {
    file.into_path().ok()?.into_os_string().into_string().ok()
}

async fn worker<T: Send + 'static>(
    operation: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "ui:workerExited".to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum InputMedia {
    Images,
    Videos,
}

#[tauri::command]
async fn choose_inputs(
    app: tauri::AppHandle, title: String, filter: String, media: Option<InputMedia>, single: Option<bool>,
) -> AppResult<Vec<String>> {
    worker(move || {
        let images = [
            "gif", "webp", "png", "apng", "jpg", "jpeg", "heic", "heif", "avif",
            "tif", "tiff", "bmp", "ico", "psd", "jp2", "j2k", "jxl",
        ];
        let videos = ["mp4", "mov", "webm"];
        let formats = match media {
            Some(InputMedia::Images) => images.to_vec(),
            Some(InputMedia::Videos) => videos.to_vec(),
            None => images.into_iter().chain(videos).collect(),
        };
        let picker = app
            .dialog()
            .file()
            .set_title(title)
            .add_filter(filter, &formats);
        let picked = if single.unwrap_or_default() {
            picker.blocking_pick_file().into_iter().collect()
        } else {
            picker.blocking_pick_files().unwrap_or_default()
        };
        Ok(picked.into_iter().filter_map(local_path).collect())
    })
    .await
}

#[tauri::command]
async fn choose_output(app: tauri::AppHandle, title: String) -> AppResult<Option<String>> {
    worker(move || Ok(app.dialog().file().set_title(title).blocking_pick_folder().and_then(local_path))).await
}

fn codec_path() -> AppResult<PathBuf> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let bundled = exe.with_file_name("any2webp-codec");
    if bundled.is_file() {
        return Ok(bundled);
    }
    #[cfg(target_arch = "aarch64")]
    let name = "any2webp-codec-aarch64-apple-darwin";
    #[cfg(target_arch = "x86_64")]
    let name = "any2webp-codec-x86_64-apple-darwin";
    let local = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(name);
    if local.is_file() {
        return Ok(local);
    }
    Err("ui:codecMissing".into())
}

fn run_codec(args: &[&Path], cancel: Option<&AtomicBool>) -> AppResult<Vec<u8>> {
    let timeout = match args.first().and_then(|arg| arg.to_str()) {
        Some("convert" | "convert-video" | "convert-gif" | "convert-video-gif"
             | "convert-frames" | "convert-frames-gif") => 300,
        Some("preview-frames") => 120,
        _ => 40,
    };
    let mut command = Command::new(codec_path()?);
    command.args(args);
    run_process(command, CODEC_TOOL, timeout, cancel)
}

fn read_process_pipe(
    reader: &mut dyn Read,
    chunk: &mut [u8],
    output: &mut Vec<u8>,
    limit: usize,
) -> io::Result<bool> {
    match reader.read(chunk) {
        Ok(0) => Ok(false),
        Ok(count) => {
            output.extend_from_slice(&chunk[..count.min(limit - output.len())]);
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::Interrupted => Ok(true),
        Err(error) => Err(error),
    }
}

fn process_has_exited(pid: libc::pid_t) -> io::Result<bool> {
    let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
    // Preserve the leader's PID until any remaining members of its group are stopped.
    let status = unsafe {
        libc::waitid(
            libc::P_PID,
            pid as libc::id_t,
            info.as_mut_ptr(),
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    };
    if status == 0 {
        // A zero si_pid means no waitable child yet.
        Ok(unsafe { info.assume_init().si_pid() } != 0)
    } else {
        Err(io::Error::last_os_error())
    }
}

fn run_process(
    mut command: Command,
    tool: &str,
    timeout: u64,
    cancel: Option<&AtomicBool>,
) -> AppResult<Vec<u8>> {
    use std::os::{fd::AsRawFd, unix::process::CommandExt};

    if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("ui:cancelled".into());
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|error| format!("ui:externalStart:{tool}: {error}"))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut pipes = [stdout.as_raw_fd(), stderr.as_raw_fd()].map(|fd| libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    });
    let mut readers: [&mut dyn Read; 2] = [&mut stdout, &mut stderr];
    let mut output = [Vec::new(), Vec::new()];
    let mut chunk = [0; 64 * 1024];
    let limits = [16 * 1024 * 1024, 32 * 1024];
    let pid = child.id() as libc::pid_t;
    let stop_group = || {
        // process_group(0) placed this child in a new group with its own PID.
        // The leader remains unreaped, so that group ID cannot be recycled.
        unsafe { libc::killpg(pid, libc::SIGKILL) };
    };
    let mut group_owned = true;
    let collected = (|| -> AppResult<()> {
        let started = Instant::now();
        let mut exited: Option<Instant> = None;
        loop {
            if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
                return Err("ui:cancelled".into());
            }
            if let Some(finished) = exited {
                // Pipe output from the leader is already available. Bound the
                // remaining drain even if a descendant escaped its process group.
                if finished.elapsed() >= Duration::from_millis(100) {
                    break;
                }
            } else {
                if started.elapsed() >= Duration::from_secs(timeout) {
                    return Err("ui:timeout".into());
                }
                match process_has_exited(pid) {
                    Ok(true) => {
                        stop_group();
                        exited = Some(Instant::now());
                    }
                    Ok(false) => {}
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) => {
                        group_owned = error.raw_os_error() != Some(libc::ECHILD);
                        return Err(format!("ui:externalState:{error}"));
                    }
                }
            }
            let wait_ms = if exited.is_some() { 0 } else { 20 };
            // Each pipe has one reader. A ready pipe can be read without
            // blocking, and poll wakes for stderr as well as stdout.
            let ready = unsafe { libc::poll(pipes.as_mut_ptr(), pipes.len() as libc::nfds_t, wait_ms) };
            if ready < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(format!("ui:externalRead:{error}"));
            }
            if ready == 0 && exited.is_some() {
                break;
            }
            for (index, pipe) in pipes.iter_mut().enumerate() {
                if pipe.revents == 0 {
                    continue;
                }
                let open = read_process_pipe(readers[index], &mut chunk, &mut output[index], limits[index])
                    .map_err(|error| format!("ui:externalRead:{error}"))?;
                if !open {
                    pipe.fd = -1;
                }
            }
        }
        Ok(())
    })();
    if collected.is_err() && group_owned {
        stop_group();
    }
    let status = child.wait();
    collected?;
    let status = status.map_err(|error| format!("ui:externalState:{error}"))?;
    let [out, err] = output;
    if status.success() {
        return Ok(out);
    }
    let message = String::from_utf8_lossy(&err);
    let detail = message.trim();
    if detail.is_empty() {
        return Err(format!("ui:externalFailure:{tool}"));
    }
    if tool == CODEC_TOOL && detail.starts_with("ui:") {
        return Err(detail.to_owned());
    }
    Err(format!("ui:externalFailure:{tool}: {detail}"))
}

fn input_path(path: &str) -> AppResult<&Path> {
    let path = Path::new(path);
    if !path.is_absolute() || !path.is_file() {
        return Err("ui:sourceMissing".into());
    }
    Ok(path)
}

fn file_revision(path: &Path) -> AppResult<String> {
    let info = fs::metadata(path).map_err(|_| "ui:sourceMissing")?;
    if !info.is_file() {
        return Err("ui:sourceMissing".into());
    }
    Ok(metadata_revision(&info))
}

fn metadata_revision(info: &fs::Metadata) -> String {
    format!("{}:{}:{}:{}.{}:{}.{}", info.dev(), info.ino(), info.len(),
        info.mtime(), info.mtime_nsec(), info.ctime(), info.ctime_nsec())
}

fn check_revision(path: &Path, expected: &str) -> AppResult<()> {
    if file_revision(path).as_deref() != Ok(expected) {
        return Err("ui:sourceChanged".into());
    }
    Ok(())
}

#[derive(Default)]
struct PreviewJob(Job);

#[derive(Default)]
struct TrimPlaybackJob(Job);

async fn preview_work<T: Send + 'static>(
    jobs: &Job,
    request_id: u64,
    operation: impl FnOnce(&AtomicBool) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let cancel = jobs.begin(request_id)?;
    let result = worker(move || operation(&cancel)).await;
    jobs.finish();
    result
}

#[tauri::command]
async fn probe_video(jobs: State<'_, PreviewJob>, request_id: u64, path: String) -> AppResult<video::Info> {
    preview_work(&jobs.0, request_id, move |cancel| video::probe(input_path(&path)?, Some(cancel))).await
}

#[tauri::command]
async fn preview(
    jobs: State<'_, PreviewJob>,
    request_id: u64,
    path: String,
    video_settings: Option<video::Settings>,
    adjustment: Option<adjustment::ImageAdjustment>,
    frame_edit: Option<frames::Edit>,
) -> AppResult<Response> {
    preview_work(&jobs.0, request_id, move |cancel| {
        let adjustment = adjustment.unwrap_or_default();
        if let Some(edit) = frame_edit {
            let prepared = edit.prepare(cancel)?;
            let bytes = adjustment.run_codec(&[Path::new("preview-frames"), prepared.path()], Some(cancel))?;
            prepared.verify(cancel)?;
            return Ok(stamped_preview(bytes, &prepared.revision));
        }
        let source = input_path(&path)?;
        let revision = file_revision(source)?;
        let bytes = preview_source(source, video_settings, adjustment, cancel)?;
        check_revision(source, &revision)?;
        Ok(stamped_preview(bytes, &revision))
    }).await
}

fn stamped_preview(mut bytes: Vec<u8>, revision: &str) -> Response {
    bytes.extend_from_slice(revision.as_bytes());
    bytes.extend_from_slice(&(revision.len() as u32).to_le_bytes());
    Response::new(bytes)
}

#[tauri::command]
async fn frame_asset(path: String) -> AppResult<Response> {
    worker(move || {
        let source = input_path(&path)?;
        if video::is_video(source) {
            return Err("ui:frameUseStill".into());
        }
        let bytes = run_codec(&[Path::new("preview"), source], None)?;
        Ok(Response::new(bytes))
    }).await
}

fn preview_source(
    source: &Path, video_settings: Option<video::Settings>,
    adjustment: adjustment::ImageAdjustment, cancel: &AtomicBool,
) -> AppResult<Vec<u8>> {
    if video::is_video(source) {
        let (frames, _) = video::extract(source, video_settings, Some(cancel))?;
        frames.preview_adjusted(adjustment, Some(cancel))
    } else {
        adjustment.run_codec(&[Path::new("preview"), source], Some(cancel))
    }
}

#[tauri::command]
fn cancel_preview(jobs: State<'_, PreviewJob>, request_id: u64) -> AppResult<()> {
    jobs.0.cancel(request_id)
}

#[tauri::command]
async fn trim_playback(
    jobs: State<'_, TrimPlaybackJob>, request_id: u64, path: String, start_ms: u64, end_ms: u64,
) -> AppResult<Response> {
    preview_work(&jobs.0, request_id, move |cancel| {
        let source = input_path(&path)?;
        if !video::is_video(source) {
            return Err("ui:unsupportedVideo".into());
        }
        let revision = file_revision(source)?;
        let settings = video::playback_settings(start_ms, end_ms)?;
        let bytes = preview_source(source, Some(settings), Default::default(), cancel)?;
        check_revision(source, &revision)?;
        Ok(Response::new(bytes))
    }).await
}

#[tauri::command]
fn cancel_trim_playback(jobs: State<'_, TrimPlaybackJob>, request_id: u64) -> AppResult<()> {
    jobs.0.cancel(request_id)
}

#[derive(Default)]
struct NavigationJobs {
    strip: Job,
    frame: Job,
}

#[tauri::command]
async fn video_navigation(
    jobs: State<'_, NavigationJobs>,
    request_id: u64,
    path: String,
    time_ms: Option<u64>,
    range: Option<video::NavigationRange>,
) -> AppResult<Response> {
    let lane = if time_ms.is_some() { &jobs.frame } else { &jobs.strip };
    preview_work(lane, request_id, move |cancel| {
        let path = input_path(&path)?;
        let revision = file_revision(path)?;
        let tools = video_tools::find_tools(Some(cancel))?;
        let source = video::NavigationSource::open(path, tools, cancel)?;
        let bytes = source.read(path, time_ms, range, cancel)?;
        check_revision(path, &revision)?;
        Ok(Response::new(bytes))
    }).await
}

#[tauri::command]
fn cancel_video_navigation(jobs: State<'_, NavigationJobs>, request_id: u64, single: bool) -> AppResult<()> {
    if single { jobs.frame.cancel(request_id) } else { jobs.strip.cancel(request_id) }
}

// Some destinations support exclusive creation but reject both exclusive
// rename and hard links. Copy only into a name we successfully reserved.
fn copy_noclobber(temp: &mut NamedTempFile, path: &Path, cancel: &AtomicBool) -> io::Result<fs::File> {
    let mut dest = fs::OpenOptions::new().read(true).write(true).create_new(true).open(path)?;
    let result = (|| {
        let source = temp.as_file_mut();
        source.seek(io::SeekFrom::Start(0))?;
        let mut buffer = [0; 64 * 1024];
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(io::ErrorKind::Interrupted.into());
            }
            let count = source.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            dest.write_all(&buffer[..count])?;
        }
        dest.flush()?;
        if cancel.load(Ordering::Relaxed) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        Ok(())
    })();
    if let Err(error) = result {
        drop(dest);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(dest)
}

fn needs_copy_fallback(error: &io::Error) -> bool {
    // macOS has separate ENOTSUP (45) and EOPNOTSUPP (102) values.
    error.kind() == io::ErrorKind::Unsupported || matches!(error.raw_os_error(), Some(45 | 102))
}

fn publish(
    mut temp: NamedTempFile,
    directory: &Path,
    source: &Path,
    source_format: &str,
    format: OutputFormat,
    expected: u64,
    cancel: &AtomicBool,
) -> AppResult<(PathBuf, fs::File)> {
    if cancel.load(Ordering::Relaxed) {
        return Err("ui:cancelled".into());
    }
    verify_output(temp.as_file_mut(), expected, format)?;
    let name = source.file_stem().and_then(|value| value.to_str()).unwrap_or("Image");
    let cutoff = name.char_indices().take_while(|(index, _)| *index < 160).last()
        .map(|(index, letter)| index + letter.len_utf8()).unwrap_or(0);
    let stem = &name[..cutoff];
    let suffix = match source_format {
        "FRMS" => "-animation",
        other if other == format.label() => "-compressed",
        _ => "",
    };
    let extension = format.extension();
    let save_error = format.save_error();
    let mut use_copy = false;
    for copy in 1..=9999 {
        if cancel.load(Ordering::Relaxed) {
            return Err("ui:cancelled".into());
        }
        let filename = if copy == 1 {
            format!("{stem}{suffix}.{extension}")
        } else {
            format!("{stem}{suffix}-{copy}.{extension}")
        };
        let path = directory.join(filename);
        if !use_copy {
            match temp.persist_noclobber(&path) {
                Ok(file) => return Ok((path, file)),
                Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                    temp = error.file;
                    continue;
                }
                Err(error) if needs_copy_fallback(&error.error) => {
                    temp = error.file;
                    use_copy = true;
                }
                Err(error) => return Err(format!("ui:{save_error}:{}", error.error)),
            }
        }
        match copy_noclobber(&mut temp, &path, cancel) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) if cancel.load(Ordering::Relaxed) => return Err("ui:cancelled".into()),
            Err(error) => return Err(format!("ui:{save_error}:{error}")),
        }
    }
    Err("ui:tooManyDuplicates".into())
}

fn verify_output(file: &mut fs::File, expected: u64, format: OutputFormat) -> AppResult<()> {
    let mut header = [0; 12];
    let info = file.metadata().map_err(|_| "ui:outputRead")?;
    let size = info.len();
    if !info.is_file() || size != expected {
        return Err("ui:outputIntegrity".into());
    }
    file.rewind().map_err(|_| "ui:outputIntegrity")?;
    file.read_exact(&mut header).map_err(|_| "ui:outputIntegrity")?;
    let valid = match format {
        OutputFormat::Webp => {
            let riff_size = u32::from_le_bytes(header[4..8].try_into().expect("RIFF size"));
            u64::from(riff_size) + 8 == size && &header[..4] == b"RIFF" && &header[8..] == b"WEBP"
        }
        OutputFormat::Gif => {
            let mut trailer = [0];
            file.seek(SeekFrom::End(-1)).map_err(|_| "ui:outputIntegrity")?;
            file.read_exact(&mut trailer).map_err(|_| "ui:outputIntegrity")?;
            &header[..6] == b"GIF89a" && trailer[0] == 0x3b
        }
    };
    if !valid {
        return Err("ui:outputIntegrity".into());
    }
    Ok(())
}

fn verify_delivered(path: &Path, file: &mut fs::File, expected: u64, format: OutputFormat) -> AppResult<String> {
    let revision = metadata_revision(&file.metadata().map_err(|_| "ui:outputRead")?);
    verify_output(file, expected, format)?;
    if file_revision(path).as_deref() != Ok(revision.as_str()) {
        return Err("ui:outputChanged".into());
    }
    Ok(revision)
}

fn export_directory<'a>(destination: Option<&'a str>, source: Option<&'a Path>) -> AppResult<&'a Path> {
    destination.map(Path::new)
        .or_else(|| source.and_then(Path::parent))
        .filter(|path| path.is_absolute() && path.is_dir())
        .ok_or_else(|| "ui:destinationMissing".into())
}

fn export(
    path: String,
    destination: Option<String>,
    target_bytes: u64,
    format: OutputFormat,
    video_settings: Option<video::Settings>,
    frame_edit: Option<frames::Edit>,
    adjustment: adjustment::ImageAdjustment,
    cancel: Arc<AtomicBool>,
) -> AppResult<Conversion> {
    if cancel.load(Ordering::Relaxed) {
        return Err("ui:cancelled".into());
    }
    let prepared = frame_edit.as_ref().map(|edit| edit.prepare(&cancel)).transpose()?;
    let (source, source_revision) = if let Some(edit) = &prepared {
        let source = Path::new(&path);
        if !source.is_absolute() || source.file_name().is_none() {
            return Err("ui:sourceMissing".into());
        }
        (source, edit.revision.clone())
    } else {
        let source = input_path(&path)?;
        (source, file_revision(source)?)
    };
    let directory = export_directory(destination.as_deref(), Some(source))?;
    let staging = tempfile::Builder::new()
        .prefix(".any2webp-work-")
        .tempdir_in(directory)
        .map_err(|error| format!("ui:destinationWrite:{error}"))?;
    let temp = NamedTempFile::new_in(staging.path())
        .map_err(|error| format!("ui:{}:{error}", format.save_error()))?;
    let target = target_bytes.to_string();
    let (stdout, applied_settings) = if let Some(edit) = &prepared {
        let operation = if format == OutputFormat::Gif { "convert-frames-gif" } else { "convert-frames" };
        (adjustment.run_codec(&[Path::new(operation), edit.path(), temp.path(), Path::new(&target)], Some(&cancel))?, None)
    } else if video::is_video(source) {
        let (frames, settings) = video::extract(source, video_settings, Some(&cancel))?;
        let operation = if format == OutputFormat::Gif { "convert-video-gif" } else { "convert-video" };
        (frames.encode(operation, temp.path(), &target, adjustment, &cancel)?, Some(settings))
    } else {
        let operation = if format == OutputFormat::Gif { "convert-gif" } else { "convert" };
        (adjustment.run_codec(&[Path::new(operation), source, temp.path(), Path::new(&target)], Some(&cancel))?, None)
    };
    let result: CodecResult =
        serde_json::from_slice(&stdout).map_err(|_| "ui:invalidResult")?;
    if result.output.format != format.label() ||
        (result.unchanged && (format != OutputFormat::Webp || prepared.is_some())) {
        return Err("ui:outputIntegrity".into());
    }
    if let Some(edit) = &prepared {
        edit.verify(&cancel)?;
    } else {
        check_revision(source, &source_revision)?;
    }
    let (output, output_revision) = if result.unchanged {
        if cancel.load(Ordering::Relaxed) {
            return Err("ui:cancelled".into());
        }
        check_revision(source, &source_revision)?;
        (source.to_owned(), source_revision.clone())
    } else {
        let (output, mut file) = publish(temp, directory, source, &result.source.format, format, result.output.bytes, &cancel)?;
        let revision = verify_delivered(&output, &mut file, result.output.bytes, format)?;
        (output, revision)
    };
    let mode = if result.unchanged {
        "original"
    } else if format == OutputFormat::Gif {
        "palette"
    } else if result.quality < 0 {
        "lossless"
    } else {
        "lossy"
    };
    Ok(Conversion {
        path: output.to_string_lossy().into_owned(),
        target_met: (target_bytes > 0).then_some(result.output.bytes <= target_bytes),
        video_settings: applied_settings,
        source_revision,
        output_revision,
        source: result.source,
        output: result.output,
        mode,
        quality: result.quality,
    })
}

#[tauri::command]
async fn convert(
    jobs: State<'_, Job>,
    job_id: u64,
    path: String,
    destination: Option<String>,
    target_bytes: u64,
    format: Option<OutputFormat>,
    video_settings: Option<video::Settings>,
    frame_edit: Option<frames::Edit>,
    adjustment: Option<adjustment::ImageAdjustment>,
) -> AppResult<Conversion> {
    let cancel = jobs.begin(job_id)?;
    let result = worker(move || export(
        path, destination, target_bytes, format.unwrap_or_default(), video_settings, frame_edit,
        adjustment.unwrap_or_default(), cancel,
    )).await;
    jobs.finish();
    result
}

#[tauri::command]
fn cancel(jobs: State<'_, Job>, job_id: u64) -> AppResult<()> {
    jobs.cancel(job_id)
}

#[tauri::command]
async fn open_output_folder(destination: Option<String>, source: Option<String>) -> AppResult<()> {
    worker(move || {
        let folder = export_directory(destination.as_deref(), source.as_deref().map(Path::new))?;
        let mut command = Command::new("/usr/bin/open");
        command.args(["-a", "Finder"]).arg(folder);
        run_process(command, "Finder", 15, None).map(|_| ())
    }).await
}

#[tauri::command]
async fn reveal(path: String) -> AppResult<()> {
    worker(move || {
        let path = input_path(&path)?
            .canonicalize()
            .map_err(|error| format!("ui:outputRead:{error}"))?;
        reveal_in_finder(&path)
    }).await
}

fn reveal_in_finder(path: &Path) -> AppResult<()> {
    let mut command = Command::new("/usr/bin/open");
    command.arg("-R").arg(path);
    run_process(command, "Finder", 15, None).map(|_| ())
}

fn main() {
    tauri::Builder::default()
        .manage(Job::default())
        .manage(PreviewJob::default())
        .manage(TrimPlaybackJob::default())
        .manage(NavigationJobs::default())
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(localized_menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            localized_menu::system_languages,
            localized_menu::set_menu_language,
            choose_inputs,
            choose_output,
            probe_video,
            preview,
            frame_asset,
            cancel_preview,
            trim_playback,
            cancel_trim_playback,
            video_navigation,
            cancel_video_navigation,
            convert,
            cancel,
            open_output_folder,
            reveal,
            video_tools::check_video_dependencies,
            video_tools::install_video_dependencies,
            video_tools::open_homebrew,
            updates::check_for_updates,
            updates::open_update_page
        ])
        .run(tauri::generate_context!())
        .expect("unable to start Any2WebP");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn input_revision_rejects_a_file_replaced_at_the_same_path() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("source.gif");
        let replacement = folder.path().join("replacement.gif");
        fs::write(&path, "first").unwrap();
        let before = file_revision(&path).unwrap();
        check_revision(&path, &before).unwrap();
        fs::write(&replacement, "other").unwrap();
        fs::rename(replacement, &path).unwrap();
        assert!(check_revision(&path, &before).is_err());
    }

    #[test]
    fn cancelling_a_preview_stops_the_worker_and_keeps_later_requests_available() {
        let jobs = Job::default();
        jobs.cancel(1).unwrap();
        assert!(jobs.begin(1).is_err());
        let flag = jobs.begin(2).unwrap();
        let started = Instant::now();
        thread::scope(|scope| {
            scope.spawn(|| {
                thread::sleep(Duration::from_millis(100));
                jobs.cancel(2).unwrap();
            });
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "/bin/sleep 8 & wait"]);
            assert_eq!(run_process(command, "preview test", 5, Some(&flag)).unwrap_err(), "ui:cancelled");
        });
        assert!(started.elapsed() < Duration::from_secs(3));
        jobs.finish();
        assert!(!jobs.begin(3).unwrap().load(Ordering::Relaxed));
    }

    #[test]
    fn subprocess_timeout_stops_children_with_inherited_pipes() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "/bin/sleep 8 & wait"]);
        let started = Instant::now();
        assert_eq!(run_process(command, "timeout test", 1, None).unwrap_err(), "ui:timeout");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn successful_subprocess_exit_does_not_wait_on_a_background_pipe() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf ready; /bin/sleep 8 &"]);
        let started = Instant::now();
        assert_eq!(run_process(command, "pipe test", 5, None).unwrap(), b"ready");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn process_runner_drains_both_pipes_above_the_retention_limits() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", concat!(
            "/bin/dd if=/dev/zero bs=1048576 count=18 2>/dev/null & ",
            "/bin/dd if=/dev/zero bs=65536 count=2 >&2 2>/dev/null & wait"
        )]);
        let output = run_process(command, "output limit test", 5, None).unwrap();
        assert_eq!(output.len(), 16 * 1024 * 1024);
    }

    #[test]
    fn process_runner_preserves_only_codec_localization_keys() {
        let command = || {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "printf 'ui:frameEditorBudget\\n' >&2; exit 1"]);
            command
        };
        assert_eq!(run_process(command(), CODEC_TOOL, 5, None).unwrap_err(), "ui:frameEditorBudget");
        assert_eq!(run_process(command(), "test tool", 5, None).unwrap_err(), "ui:externalFailure:test tool: ui:frameEditorBudget");
    }

    #[test]
    fn invalid_staged_output_is_rejected_before_publish() {
        let folder = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir_in(folder.path()).unwrap();
        let temp = NamedTempFile::new_in(staging.path()).unwrap();
        let bytes = b"RIFF\x04\x00\x00\x00WAVE";
        fs::write(temp.path(), bytes).unwrap();
        let result = publish(
            temp, folder.path(), Path::new("source.png"), "PNG", OutputFormat::Webp,
            bytes.len() as u64, &AtomicBool::new(false),
        );
        assert_eq!(result.unwrap_err(), "ui:outputIntegrity");
        assert!(!folder.path().join("source.webp").exists());
    }

    #[test]
    fn output_verification_detects_a_replacement_with_the_same_header_and_size() {
        let folder = tempfile::tempdir().unwrap();
        let temp = NamedTempFile::new_in(folder.path()).unwrap();
        let bytes = b"RIFF\x04\x00\x00\x00WEBP";
        fs::write(temp.path(), bytes).unwrap();
        let (output, mut file) = publish(
            temp, folder.path(), Path::new("source.png"), "PNG", OutputFormat::Webp,
            bytes.len() as u64, &AtomicBool::new(false),
        ).unwrap();
        assert!(verify_delivered(&output, &mut file, bytes.len() as u64, OutputFormat::Webp).is_ok());
        let replacement = folder.path().join("other.webp");
        fs::write(&replacement, bytes).unwrap();
        fs::rename(replacement, &output).unwrap();
        assert_eq!(
            verify_delivered(&output, &mut file, bytes.len() as u64, OutputFormat::Webp).unwrap_err(),
            "ui:outputChanged",
        );
    }

    #[test]
    fn exclusive_copy_preserves_existing_files_and_cleans_up_cancellation() {
        assert!(needs_copy_fallback(&io::Error::from_raw_os_error(45)));
        assert!(needs_copy_fallback(&io::Error::from_raw_os_error(102)));
        let directory = tempfile::tempdir().unwrap();
        let mut temp = NamedTempFile::new_in(directory.path()).unwrap();
        fs::write(temp.path(), b"export bytes").unwrap();
        let final_path = directory.path().join("result.webp");
        let cancelled = AtomicBool::new(false);
        copy_noclobber(&mut temp, &final_path, &cancelled).unwrap();
        assert_eq!(fs::read(&final_path).unwrap(), b"export bytes");
        let duplicate = copy_noclobber(&mut temp, &final_path, &cancelled).unwrap_err();
        assert_eq!(duplicate.kind(), io::ErrorKind::AlreadyExists);
        let pending = directory.path().join("cancelled.webp");
        cancelled.store(true, Ordering::Relaxed);
        assert!(copy_noclobber(&mut temp, &pending, &cancelled).is_err());
        assert!(!pending.exists());
        assert_eq!(fs::read(&final_path).unwrap(), b"export bytes");
    }

    #[test]
    fn export_still_png_to_webp_and_gif() {
        // Two-pixel RGBA PNG containing opaque red and fully transparent pixels.
        let png = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0xf4, 0x22, 0x7f, 0x8a, 0x00, 0x00, 0x00,
            0x0f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
            0x44, 0x0c, 0x0c, 0x00, 0x0c, 0xfc, 0x01, 0xff, 0x5c, 0xfd, 0x14, 0x95,
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("still.png");
        fs::write(&source, png).unwrap();
        for format in [OutputFormat::Webp, OutputFormat::Gif] {
            let result = export(
                source.to_str().unwrap().to_owned(), None, 1024, format, None, None,
                Default::default(), Arc::new(AtomicBool::new(false)),
            ).unwrap();
            let path = source.with_extension(format.extension());
            assert_eq!(Path::new(&result.path), path);
            assert_eq!(file_revision(&path).unwrap(), result.output_revision);
            let decoded = run_codec(&[Path::new("inspect"), &path], None).unwrap();
            let info: ImageInfo = serde_json::from_slice(&decoded).unwrap();
            assert_eq!(info.format, format.label());
            assert_eq!((info.width, info.height, info.plays), (2, 1, 1));
            assert_eq!(info.delays, [0]);
            assert!(!info.animated && info.alpha);
        }
        assert_eq!(fs::read(&source).unwrap(), png);
    }

    #[test]
    fn export_applies_the_frame_plan_and_checks_its_source_revision() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("original.gif");
        fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("../engine/samples/planet.gif"), &source).unwrap();
        let edit = serde_json::json!({
            "width": 160, "height": 112, "plays": 3,
            "frames": [
                { "path": source, "index": 7, "delay": 100 },
                { "path": source, "index": 1, "delay": 500 },
            ]
        });
        let plan: frames::Edit = serde_json::from_value(edit.clone()).unwrap();
        let cancel = AtomicBool::new(false);
        let prepared = plan.prepare(&cancel).unwrap();
        let result = export(
            source.to_str().unwrap().to_owned(), None, 1024, OutputFormat::Gif, None, Some(plan),
            Default::default(), Arc::new(AtomicBool::new(false)),
        ).unwrap();
        assert!(result.path.ends_with("/original-animation.gif"));
        assert_eq!(result.source_revision, prepared.revision);
        assert_eq!(result.output.delays, [100, 500]);
        assert_eq!(result.output.plays, 3);
        assert!(result.output.alpha);
        fs::write(&source, b"changed").unwrap();
        assert_eq!(prepared.verify(&cancel).unwrap_err(), "ui:sourceChanged");
    }

    #[test]
    fn export_gif_and_apng_to_optional_test_volume() {
        let Some(path) = std::env::var_os("ANY2WEBP_TEST_VOLUME") else { return };
        let temporary = tempfile::tempdir_in(path).unwrap();
        let destination = temporary.path().to_str().unwrap();
        let work = tempfile::tempdir_in(destination).unwrap();
        let sample_temp = NamedTempFile::new_in(work.path()).unwrap();
        let atomic = work.path().join("rename-probe");
        match sample_temp.persist_noclobber(atomic) {
            Err(error) => eprintln!("Test volume atomic save error: {}", error.error),
            Ok(_) => eprintln!("Test volume supports this exclusive rename"),
        }
        drop(work);
        let media = std::env::var("ANY2WEBP_TEST_APNG").unwrap();
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../engine/samples/planet.gif");
        for source in [sample.to_str().unwrap(), &media] {
            let first = export(
                source.to_owned(), Some(destination.into()), 0, OutputFormat::Webp, None, None, Default::default(), Arc::new(AtomicBool::new(false))
            ).unwrap();
            let second = export(
                source.to_owned(), Some(destination.into()), 0, OutputFormat::Webp, None, None, Default::default(), Arc::new(AtomicBool::new(false))
            ).unwrap();
            assert!(first.path.ends_with(".webp") && second.path.ends_with("-2.webp"));
            let body = fs::read(&first.path).unwrap();
            assert_eq!(body, fs::read(&second.path).unwrap());
            assert_eq!(&body[..4], b"RIFF");
            let inspected = run_codec(&[Path::new("inspect"), Path::new(&first.path)], None).unwrap();
            let output: ImageInfo = serde_json::from_slice(&inspected).unwrap();
            assert_eq!(output.delays, first.output.delays);
            assert_eq!(output.plays, first.output.plays);
        }
        let names: Vec<_> = fs::read_dir(temporary.path()).unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| !name.starts_with("._")) // macOS may add AppleDouble companions.
            .collect();
        assert_eq!(names.len(), 4);
        assert!(names.iter().all(|name| name.ends_with(".webp") && !name.starts_with('.')));
    }
}
