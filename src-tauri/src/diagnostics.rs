use crate::{adjustment::ImageAdjustment, frames, video, worker, AppResult, ExportFailure,
    FailureStage, OutputFormat};
use serde::{Deserialize, Serialize};
use std::{fmt::Display, io::Write, path::Path, sync::Mutex};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;
use windows_sys::{
    Wdk::System::SystemServices::RtlGetVersion,
    Win32::System::SystemInformation::OSVERSIONINFOW,
};

const UNKNOWN: &str = "UNKNOWN";
const SAVE_ERROR: &str = "ui:diagnosticSaveFailed";

#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq, Serialize)]
pub(crate) enum InputFormat {
    #[default]
    Unknown,
    Jpeg,
    Png,
    Gif,
    Webp,
    Mp4,
    Mov,
    Webm,
    Mixed,
}

impl InputFormat {
    pub(crate) fn from_path(path: &Path) -> Self {
        let extension = path.extension().and_then(|ext| ext.to_str());
        match extension.map(str::to_ascii_lowercase).as_deref() {
            Some("jpg" | "jpeg") => Self::Jpeg,
            Some("png") => Self::Png,
            Some("gif") => Self::Gif,
            Some("webp") => Self::Webp,
            Some("mp4") => Self::Mp4,
            Some("mov") => Self::Mov,
            Some("webm") => Self::Webm,
            _ => Self::Unknown,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Unknown => UNKNOWN,
            Self::Jpeg => "JPEG",
            Self::Png => "PNG",
            Self::Gif => "GIF",
            Self::Webp => "WebP",
            Self::Mp4 => "MP4",
            Self::Mov => "MOV",
            Self::Webm => "WebM",
            Self::Mixed => "MIXED",
        }
    }
}

#[derive(Deserialize, Serialize)]
pub(crate) struct FrameParameters {
    pub input: InputFormat,
    pub width: u32,
    pub height: u32,
    pub plays: u32,
    pub count: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
enum ErrorCode {
    Cancelled,
    JobUnavailable,
    SourceUnavailable,
    SourceChanged,
    DestinationUnavailable,
    OutputWriteFailed,
    VideoToolsUnavailable,
    InvalidVideo,
    InvalidParameters,
    UnsupportedFormat,
    DecodeFailed,
    EncodeFailed,
    ResourceLimit,
    OutputVerificationFailed,
    ToolUnavailable,
    ToolExecutionFailed,
    Timeout,
    WorkerExited,
}

// Only the application packet tag is considered. Process output and OS
// messages can follow it, so neither the suffix nor an unknown tag is returned.
fn classify(message: &str) -> (&'static str, Option<ErrorCode>) {
    use ErrorCode::*;
    let key = message.strip_prefix("ui:").unwrap_or("").split(':').next().unwrap_or("");
    let (label, code) = match key {
        "cancelled" if message == "ui:cancelled" => ("ui:cancelled", Cancelled),
        "jobBusy" => ("ui:jobBusy", JobUnavailable),
        "jobQueueUnavailable" => ("ui:jobQueueUnavailable", JobUnavailable),
        "sourceMissing" | "invalidPath" => ("ui:sourceMissing", SourceUnavailable),
        "sourceChanged" => ("ui:sourceChanged", SourceChanged),
        "destinationMissing" => ("ui:destinationMissing", DestinationUnavailable),
        "destinationWrite" => ("ui:destinationWrite", DestinationUnavailable),
        "saveWebp" => ("ui:saveWebp", OutputWriteFailed),
        "saveGif" => ("ui:saveGif", OutputWriteFailed),
        "tooManyDuplicates" => ("ui:tooManyDuplicates", OutputWriteFailed),
        "outputWrite" | "videoTemp" => ("ui:outputWrite", OutputWriteFailed),
        "ffmpegMissing" => ("ui:ffmpegMissing", VideoToolsUnavailable),
        "ffmpegIncomplete" => ("ui:ffmpegIncomplete", VideoToolsUnavailable),
        "ffmpegUnusable" => ("ui:ffmpegUnusable", VideoToolsUnavailable),
        "invalidVideo" | "noVideoTrack" | "noDuration" => ("ui:invalidVideo", InvalidVideo),
        "incompleteVideo" => ("ui:incompleteVideo", DecodeFailed),
        "invalidTrim" => ("ui:invalidTrim", InvalidParameters),
        "invalidDimensions" | "invalidCanvas" => ("ui:invalidDimensions", InvalidParameters),
        "minFrames" => ("ui:minFrames", InvalidParameters),
        "maxFrames" => ("ui:maxFrames", InvalidParameters),
        "invalidFrameEdit" => ("ui:invalidFrameEdit", InvalidParameters),
        "invalidStrength" => ("ui:invalidStrength", InvalidParameters),
        "invalidTarget" => ("ui:invalidTarget", InvalidParameters),
        "unsupportedVideo" => ("ui:unsupportedVideo", UnsupportedFormat),
        "windowsAnimatedPng" => ("ui:windowsAnimatedPng", UnsupportedFormat),
        "unsupportedMultiFrame" => ("ui:unsupportedMultiFrame", UnsupportedFormat),
        "unsupportedImage" => ("ui:unsupportedImage", UnsupportedFormat),
        "decodeApng" => ("ui:decodeApng", DecodeFailed),
        "decodeGif" => ("ui:decodeGif", DecodeFailed),
        "decodeWebp" => ("ui:decodeWebp", DecodeFailed),
        "decodeImage" | "noFrames" => ("ui:decodeImage", DecodeFailed),
        "encodeWebp" | "preserveMetadata" => ("ui:encodeWebp", EncodeFailed),
        "encodeGif" => ("ui:encodeGif", EncodeFailed),
        "gifDelayLimit" => ("ui:gifDelayLimit", EncodeFailed),
        "frameDelayLimit" => ("ui:frameDelayLimit", EncodeFailed),
        "memoryLimit" => ("ui:memoryLimit", ResourceLimit),
        "animationLimit" => ("ui:animationLimit", ResourceLimit),
        "frameEditorBudget" => ("ui:frameEditorBudget", ResourceLimit),
        "inputFileLimit" => ("ui:inputFileLimit", ResourceLimit),
        "outputLimit" => ("ui:outputLimit", ResourceLimit),
        "invalidResult" => ("ui:invalidResult", OutputVerificationFailed),
        "outputChanged" | "outputRead" | "outputIntegrity" => ("ui:outputIntegrity", OutputVerificationFailed),
        "codecMissing" => ("ui:codecMissing", ToolUnavailable),
        "externalStart" => ("ui:externalStart", ToolUnavailable),
        "externalFailure" | "externalRead" | "externalState" => ("ui:externalFailure", ToolExecutionFailed),
        "timeout" => ("ui:timeout", Timeout),
        "workerExited" => ("ui:workerExited", WorkerExited),
        _ => return ("ui:diagnosticConversionFailed", None),
    };
    (label, Some(code))
}

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct Report {
    input: InputFormat,
    output: Option<OutputFormat>,
    target_bytes: Option<u64>,
    strengths: Option<[u8; 3]>,
    video: Option<video::Settings>,
    frames: Option<FrameParameters>,
    stage: Option<FailureStage>,
    code: Option<ErrorCode>,
}

#[derive(Serialize)]
pub(crate) struct ConversionFailure {
    message: &'static str,
    diagnostic: Report,
}

impl Report {
    pub(crate) fn conversion(path: &Path, target_bytes: u64, output: OutputFormat,
        video: Option<video::Settings>, edit: Option<&frames::Edit>, quality: ImageAdjustment,
    ) -> Self {
        let frames = edit.map(frames::Edit::diagnostic_parameters);
        let input = frames.as_ref().map(|frames| frames.input).unwrap_or_else(|| InputFormat::from_path(path));
        Self { input, output: Some(output), target_bytes: Some(target_bytes), video, frames,
            strengths: Some([quality.shadows, quality.denoise, quality.sharpen]), ..Self::default() }
    }

    pub(crate) fn with_failure(mut self, error: ExportFailure) -> ConversionFailure {
        let (message, code) = classify(&error.message);
        self.stage = Some(error.stage);
        self.code = code;
        ConversionFailure { message, diagnostic: self }
    }

    fn render(&self) -> String {
        let mut text = String::new();
        use std::fmt::Write as _;
        let [shadows, denoise, sharpen] = self.strengths.map(|values| values.map(Some)).unwrap_or([None; 3]);
        let target = match self.target_bytes {
            Some(0) => "OFF".to_string(),
            bytes => value(bytes),
        };
        let video = self.video;
        let frames = self.frames.as_ref();
        let _ = write!(text, concat!(
            "Any2WebP version: {}\r\nWindows version: {}\r\n",
            "Input format: {}\r\nOutput format: {}\r\n",
            "Target bytes: {}\r\nShadows: {}\r\nDenoise: {}\r\nSharpen: {}\r\n",
            "Video start (ms): {}\r\nVideo end (ms): {}\r\nVideo FPS: {}\r\nVideo edge (px): {}\r\n",
            "Frame count: {}\r\nCanvas width (px): {}\r\nCanvas height (px): {}\r\nAnimation plays: {}\r\n",
            "Failure stage: {}\r\nError code: {}\r\n"),
            env!("CARGO_PKG_VERSION"), windows_version(), self.input.label(),
            self.output.map(OutputFormat::label).unwrap_or(UNKNOWN),
            target, value(shadows), value(denoise), value(sharpen),
            value(video.map(|v| v.start_ms)), value(video.map(|v| v.end_ms)),
            value(video.map(|v| v.fps)), value(video.map(|v| v.edge)),
            value(frames.map(|f| f.count)), value(frames.map(|f| f.width)),
            value(frames.map(|f| f.height)), value(frames.map(|f| f.plays)),
            self.stage.map(|stage| format!("{stage:?}")).unwrap_or_else(|| UNKNOWN.into()),
            self.code.map(|code| format!("{code:?}")).unwrap_or_else(|| UNKNOWN.into()));
        text
    }
}

fn value(number: Option<impl Display>) -> String {
    number.map(|number| number.to_string()).unwrap_or_else(|| UNKNOWN.into())
}

fn windows_version() -> String {
    let mut version = OSVERSIONINFOW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
        ..Default::default()
    };
    if unsafe { RtlGetVersion(&mut version) } != 0 {
        return UNKNOWN.into();
    }
    format!("{}.{}.{}", version.dwMajorVersion, version.dwMinorVersion, version.dwBuildNumber)
}

#[derive(Default)]
pub(crate) struct Preview(Mutex<Option<String>>);

#[tauri::command]
pub(crate) fn preview_diagnostic_report(preview: State<'_, Preview>, report: Option<Report>) -> AppResult<String> {
    let text = report.unwrap_or_default().render();
    *preview.0.lock().map_err(|_| "ui:diagnosticPreviewFailed")? = Some(text.clone());
    Ok(text)
}

fn save_report(path: &Path, text: &str) -> AppResult<()> {
    if !path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("txt")) {
        return Err("ui:diagnosticTextOnly".into());
    }
    let parent = path.parent().filter(|_| path.is_absolute()).ok_or(SAVE_ERROR)?;
    let mut pending = NamedTempFile::new_in(parent).map_err(|_| SAVE_ERROR)?;
    pending.write_all(text.as_bytes()).map_err(|_| SAVE_ERROR)?;
    pending.persist(path).map_err(|_| SAVE_ERROR)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn save_diagnostic_report(window: WebviewWindow, preview: State<'_, Preview>,
    title: String, filter: String,
) -> AppResult<bool> {
    let text = preview.0.lock().map_err(|_| SAVE_ERROR)?.clone().ok_or(SAVE_ERROR)?;
    worker(move || {
        let chosen = window.dialog().file().set_parent(&window).set_title(title)
            .add_filter(filter, &["txt"]).set_file_name("Any2WebP-diagnostics.txt").blocking_save_file();
        let Some(chosen) = chosen else { return Ok(false) };
        let path = chosen.into_path().map_err(|_| SAVE_ERROR)?;
        save_report(&path, &text)?;
        Ok(true)
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_result;

    #[test]
    fn report_excludes_process_outputs_and_paths() {
        let path = Path::new(r"C:\私有目录-DIR_4F2D\素材-FILE_8D1A.MP4");
        let video = Some(video::Settings { start_ms: 40, end_ms: 1080, fps: 15, edge: 320 });
        for (tool, stage) in [("FFmpeg", FailureStage::VideoDecode), ("ffprobe", FailureStage::VideoProbe)] {
            let output = [b"PRIVATE_STDOUT_92C7".to_vec(),
                format!("PRIVATE_STDERR_E91A: failed to read {}", path.display()).into_bytes()];
            let error = process_result(output, tool, false).unwrap_err();
            assert!(error.contains("PRIVATE_STDERR_E91A"));
            let failure = Report::conversion(path, 8192, OutputFormat::Gif, video, None, ImageAdjustment::default())
                .with_failure(stage.failure(error));
            let packet = serde_json::to_string(&failure).unwrap();
            let text = failure.diagnostic.render();
            assert_eq!(failure.message, "ui:externalFailure");
            assert!(text.contains("Input format: MP4\r\nOutput format: GIF"));
            assert!(text.contains("Target bytes: 8192"));
            assert!(text.contains("Video FPS: 15"));
            assert!(text.contains(&format!("Failure stage: {stage:?}\r\nError code: ToolExecutionFailed")));
            for marker in ["私有目录", "DIR_4F2D", "素材", "FILE_8D1A", "PRIVATE_STDOUT_92C7", "PRIVATE_STDERR_E91A"] {
                assert!(!packet.contains(marker));
                assert!(!text.contains(marker));
            }
        }
    }

    #[test]
    fn unknown_values_are_fixed_and_save_uses_preview_bytes() {
        let report = Report::conversion(Path::new("private.DIAGNOSTIC_MARKER"), 0, OutputFormat::Webp,
            None, None, ImageAdjustment::default())
            .with_failure(FailureStage::Destination.failure("ui:PRIVATE_ERROR_MARKER: raw error"));
        let preview = report.diagnostic.render();
        assert!(preview.contains("Input format: UNKNOWN"));
        assert!(preview.contains("Error code: UNKNOWN"));
        assert!(!preview.contains("MARKER"));
        let default = Report::default().render();
        assert!(default.contains("Failure stage: UNKNOWN\r\nError code: UNKNOWN"));
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("诊断 报告.TXT");
        save_report(&file, &preview).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), preview.as_bytes());
        let other = file.with_extension("log");
        assert!(save_report(&other, &preview).is_err());
        assert!(!other.exists());
    }
}
