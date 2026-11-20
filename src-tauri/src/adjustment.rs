use crate::{run_codec, AppResult};
use serde::Deserialize;
use std::{path::Path, sync::atomic::AtomicBool};

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub struct ImageAdjustment {
    pub shadows: u8,
    pub denoise: u8,
    pub sharpen: u8,
}

impl ImageAdjustment {
    pub fn run_codec(self, args: &[&Path], cancel: Option<&AtomicBool>) -> AppResult<Vec<u8>> {
        let strengths = [self.shadows, self.denoise, self.sharpen];
        if strengths.iter().any(|&value| value > 100) {
            return Err("ui:invalidStrength".into());
        }
        if strengths == [0, 0, 0] {
            return run_codec(args, cancel);
        }
        let values = strengths.map(|value| value.to_string());
        let mut adjusted_args = args.to_vec();
        adjusted_args.push(Path::new("--adjust"));
        adjusted_args.extend(values.iter().map(Path::new));
        run_codec(&adjusted_args, cancel)
    }
}
