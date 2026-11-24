use crate::{check_revision, file_revision, AppResult};
use serde::Deserialize;
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap},
    hash::{Hash, Hasher},
    io::{self, BufWriter, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use tempfile::NamedTempFile;

const MAX_FRAMES: usize = 600;
const MAX_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Deserialize, Hash)]
pub struct Edit {
    width: u32,
    height: u32,
    plays: u32,
    frames: Vec<Frame>,
}

#[derive(Deserialize, Hash)]
struct Frame {
    path: String,
    index: u32,
    delay: u32,
}

pub struct Prepared {
    manifest: NamedTempFile,
    revisions: Vec<(PathBuf, String)>,
    pub revision: String,
}

fn words(writer: &mut impl Write, values: &[u32]) -> io::Result<()> {
    for word in values {
        writer.write_all(&word.to_le_bytes())?;
    }
    Ok(())
}

impl Edit {
    #[cfg(windows)]
    pub(crate) fn diagnostic_parameters(&self) -> crate::diagnostics::FrameParameters {
        use crate::diagnostics::{FrameParameters, InputFormat};
        let mut formats = self.frames.iter().map(|frame| InputFormat::from_path(Path::new(&frame.path)));
        let first = formats.next().unwrap_or_default();
        let input = if formats.any(|format| format != first) { InputFormat::Mixed } else { first };
        FrameParameters { input, width: self.width, height: self.height,
            plays: self.plays, count: self.frames.len() }
    }

    pub fn prepare(&self, cancel: &AtomicBool) -> AppResult<Prepared> {
        if cancel.load(Ordering::Relaxed) {
            return Err("ui:cancelled".into());
        }
        let pixels = u64::from(self.width) * u64::from(self.height);
        if !(2..=MAX_FRAMES).contains(&self.frames.len()) || self.width == 0 || self.height == 0 ||
            self.width > 16383 || self.height > 16383 || pixels > MAX_PIXELS ||
            pixels * 4 * self.frames.len() as u64 > MAX_BYTES {
            return Err("ui:frameEditorBudget".into());
        }
        let mut groups = BTreeMap::<&str, Vec<[u32; 3]>>::new();
        for (slot, frame) in self.frames.iter().enumerate() {
            if frame.path.len() > 4096 || frame.path.contains('\0') ||
                frame.index as usize >= MAX_FRAMES || frame.delay > 0xffffff {
                return Err("ui:invalidFrameEdit".into());
            }
            groups.entry(&frame.path).or_default().push([slot as u32, frame.index, frame.delay]);
        }
        let mut revisions = Vec::with_capacity(groups.len());
        let mut manifest = NamedTempFile::new().map_err(|_| "ui:invalidFrameEdit")?;
        let mut writer = BufWriter::new(&mut manifest);
        let write_error = |_| "ui:invalidFrameEdit";
        words(&mut writer, &[u32::from_le_bytes(*b"A2F1"), self.width, self.height,
              self.plays, self.frames.len() as u32, groups.len() as u32]).map_err(write_error)?;
        for (path, slots) in groups {
            if cancel.load(Ordering::Relaxed) {
                return Err("ui:cancelled".into());
            }
            let source = Path::new(path);
            if !source.is_absolute() {
                return Err("ui:sourceMissing".into());
            }
            revisions.push((source.to_owned(), file_revision(source)?));
            words(&mut writer, &[path.len() as u32]).map_err(write_error)?;
            writer.write_all(path.as_bytes()).map_err(write_error)?;
            words(&mut writer, &[slots.len() as u32]).map_err(write_error)?;
            for slot in slots {
                words(&mut writer, &slot).map_err(write_error)?;
            }
        }
        writer.flush().map_err(write_error)?;
        drop(writer);
        let mut hash = DefaultHasher::new();
        self.hash(&mut hash);
        revisions.hash(&mut hash);
        Ok(Prepared { manifest, revisions, revision: format!("frames:{:016x}", hash.finish()) })
    }
}

impl Prepared {
    pub fn path(&self) -> &Path {
        self.manifest.path()
    }

    pub fn verify(&self, cancel: &AtomicBool) -> AppResult<()> {
        for (path, revision) in &self.revisions {
            if cancel.load(Ordering::Relaxed) {
                return Err("ui:cancelled".into());
            }
            check_revision(path, revision)?;
        }
        Ok(())
    }
}
