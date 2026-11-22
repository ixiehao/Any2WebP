use crate::{process_result, read_process_pipe, AppResult};
use std::{
    ffi::OsStr,
    fs::File,
    io::{self, Read},
    os::windows::{ffi::OsStrExt, io::AsRawHandle, process::CommandExt},
    path::Path,
    process::{Command, Stdio},
    ptr,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{ERROR_BROKEN_PIPE, ERROR_NO_DATA, FILETIME},
    Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION},
    System::{
        Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
        Pipes::PeekNamedPipe,
    },
    UI::{Shell::{ShellExecuteW, SHOpenFolderAndSelectItems, SHParseDisplayName}, WindowsAndMessaging::SW_SHOWNORMAL},
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(super) fn fit_startup_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use tauri::{PhysicalPosition, PhysicalSize};

    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let area = monitor.work_area();
    let outer = window.outer_size()?;
    let position = window.outer_position()?;
    let width = outer.width.min(area.size.width);
    let height = outer.height.min(area.size.height);
    if width != outer.width || height != outer.height {
        let inner = window.inner_size()?;
        window.set_size(PhysicalSize::new(
            inner.width.saturating_sub(outer.width - width),
            inner.height.saturating_sub(outer.height - height),
        ))?;
    }
    let fitted = PhysicalPosition::new(
        position.x.clamp(area.position.x, area.position.x + (area.size.width - width) as i32),
        position.y.clamp(area.position.y, area.position.y + (area.size.height - height) as i32),
    );
    if position != fitted {
        window.set_position(fitted)?;
    }
    Ok(())
}

fn available(pipe: &impl AsRawHandle) -> io::Result<bool> {
    let mut bytes = 0;
    let peeked = unsafe {
        PeekNamedPipe(pipe.as_raw_handle(), ptr::null_mut(), 0, ptr::null_mut(), &mut bytes, ptr::null_mut())
    };
    if peeked != 0 {
        return Ok(bytes != 0);
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error().map(|code| code as u32) {
        Some(ERROR_BROKEN_PIPE | ERROR_NO_DATA) => Ok(false),
        _ => Err(error),
    }
}

pub(super) fn run_process(
    mut command: Command, tool: &str, timeout: u64, cancel: Option<&AtomicBool>,
) -> AppResult<Vec<u8>> {
    let cancelled = || cancel.is_some_and(|flag| flag.load(Ordering::Relaxed));
    if cancelled() {
        return Err("ui:cancelled".into());
    }
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW).spawn()
        .map_err(|error| format!("ui:externalStart:{tool}: {error}"))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut output = [Vec::new(), Vec::new()];
    let mut chunk = [0; 64 * 1024];
    let started = Instant::now();
    let timeout = Duration::from_secs(timeout);
    // Windows preview starts the codec directly. It does not create a shell or subprocess tree.
    let result = loop {
        if cancelled() {
            break Err("ui:cancelled".into());
        }
        if started.elapsed() >= timeout {
            break Err("ui:timeout".into());
        }
        let status = match child.try_wait() {
            Ok(status) => status,
            Err(error) => break Err(format!("ui:externalState:{error}")),
        };
        let ready = match available(&stdout).and_then(|out| available(&stderr).map(|err| [out, err])) {
            Ok(ready) => ready,
            Err(error) => break Err(format!("ui:externalRead:{error}")),
        };
        let pipes: [&mut dyn Read; 2] = [&mut stdout, &mut stderr];
        for (index, pipe) in pipes.into_iter().enumerate() {
            if ready[index] {
                let limit = [16 * 1024 * 1024, 32 * 1024][index];
                if let Err(error) = read_process_pipe(pipe, &mut chunk, &mut output[index], limit) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("ui:externalRead:{error}"));
                }
            }
        }
        if !ready.into_iter().any(|ready| ready) {
            if let Some(status) = status {
                break process_result(output, tool, status.success());
            }
            thread::sleep(Duration::from_millis(8));
        }
    };
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

pub(super) fn file_revision(file: &File) -> io::Result<String> {
    if !file.metadata()?.is_file() {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let pair = |hi, lo| u64::from(hi) << 32 | u64::from(lo);
    let timestamp = |time: FILETIME| pair(time.dwHighDateTime, time.dwLowDateTime);
    Ok(format!("{}:{}:{}:{}:{}", info.dwVolumeSerialNumber,
        pair(info.nFileIndexHigh, info.nFileIndexLow), pair(info.nFileSizeHigh, info.nFileSizeLow),
        timestamp(info.ftCreationTime), timestamp(info.ftLastWriteTime)))
}

pub(super) fn open_folder(path: &Path) -> AppResult<()> {
    open_target(path.as_os_str()).map_err(|()| "ui:destinationMissing".into())
}

pub(super) fn open_url(url: &str) -> AppResult<()> {
    open_target(OsStr::new(url)).map_err(|()| "ui:aboutLinkFailed".into())
}

fn open_target(target: &OsStr) -> Result<(), ()> {
    let target = wide(target);
    let result = unsafe {
        ShellExecuteW(ptr::null_mut(), ptr::null(), target.as_ptr(), ptr::null(), ptr::null(), SW_SHOWNORMAL)
    };
    if result as isize <= 32 {
        return Err(());
    }
    Ok(())
}

pub(super) fn reveal(path: &Path) -> AppResult<()> {
    let path = wide(path.as_os_str());
    let result = unsafe {
        let apartment = CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED as u32);
        if apartment < 0 {
            return Err("ui:outputRead".into());
        }
        let mut item = ptr::null_mut();
        let mut result = SHParseDisplayName(path.as_ptr(), ptr::null_mut(), &mut item, 0, ptr::null_mut());
        if result >= 0 {
            result = SHOpenFolderAndSelectItems(item, 0, ptr::null(), 0);
            CoTaskMemFree(item.cast());
        }
        CoUninitialize();
        result
    };
    if result < 0 {
        return Err("ui:outputRead".into());
    }
    Ok(())
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}
