use crate::{run_process, worker, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use time::{format_description::well_known::Rfc2822, OffsetDateTime};

// The public repository reserved by the release runbook. A 404 means no
// public release is available yet, so the banner stays hidden.
const REPOSITORY: &str = "ixiehao/Any2WebP";
#[cfg(not(windows))]
const LATEST_URL: &str = "https://github.com/ixiehao/Any2WebP/releases/latest";
const API_URL: &str = "https://api.github.com/repos/ixiehao/Any2WebP/releases/latest";

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Check {
    Available {
        tag: String,
    },
    Current,
    Unpublished,
    RateLimited {
        #[serde(rename = "retryAt")]
        retry_at: u64,
    },
    Failed,
}

fn version(tag: &str) -> Option<[u64; 3]> {
    let mut components = tag.strip_prefix('v').unwrap_or(tag).split('.');
    let mut numbers = [0; 3];
    for number in &mut numbers {
        let component = components.next()?;
        if component.is_empty()
            || !component.bytes().all(|byte| byte.is_ascii_digit())
            || (component.len() > 1 && component.starts_with('0'))
        {
            return None;
        }
        *number = component.parse().ok()?;
    }
    components.next().is_none().then_some(numbers)
}

fn classify(tag: &str, installed: [u64; 3]) -> Option<Check> {
    Some(if version(tag)? > installed {
        Check::Available {
            tag: tag.to_owned(),
        }
    } else {
        Check::Current
    })
}

fn release_path(tag: &str) -> Option<String> {
    version(tag).map(|_| format!("/{REPOSITORY}/releases/tag/{tag}"))
}

fn redirected_tag(location: &str) -> Option<&str> {
    let path = location.strip_prefix("https://github.com").unwrap_or(location);
    let tag = path.strip_prefix(&format!("/{REPOSITORY}/releases/tag/"))?;
    version(tag)?;
    Some(tag)
}

struct Http<'a> {
    status: u16,
    headers: &'a str,
    body: &'a str,
}

impl<'a> Http<'a> {
    fn parse(mut data: &'a str) -> Option<Self> {
        loop {
            let (headers, body) = data.split_once("\r\n\r\n")?;
            let mut line = headers.lines().next()?.split_ascii_whitespace();
            if !line.next()?.starts_with("HTTP/") {
                return None;
            }
            let status: u16 = line.next()?.parse().ok()?;
            if (100..200).contains(&status) {
                data = body;
            } else {
                return Some(Self {
                    status,
                    headers,
                    body,
                });
            }
        }
    }

    fn header(&self, key: &str) -> Option<&str> {
        self.headers
            .lines()
            .skip(1)
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.eq_ignore_ascii_case(key))
            .map(|(_, value)| value.trim())
    }

    fn unavailable(&self, now: u64) -> Option<Check> {
        match self.status {
            404 => Some(Check::Unpublished),
            403 | 429 => {
                let retry_after = self.header("Retry-After").and_then(|value| {
                    if let Ok(seconds) = value.parse::<u64>() {
                        Some(now.saturating_add(seconds))
                    } else {
                        OffsetDateTime::parse(value, &Rfc2822).ok()
                            .and_then(|date| u64::try_from(date.unix_timestamp()).ok())
                    }
                });
                let reset = self.header("X-RateLimit-Reset").and_then(|value| value.parse::<u64>().ok());
                let retry_at = retry_after.into_iter()
                    .chain(reset)
                    .filter(|time| *time > now)
                    .max()
                    .unwrap_or(now + 3600);
                Some(Check::RateLimited { retry_at })
            }
            _ => None,
        }
    }
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    #[cfg(windows)]
    assets: Vec<ReleaseAsset>,
}

#[cfg(windows)]
#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    state: String,
    size: u64,
}

#[cfg(any(not(windows), test))]
fn interpret_latest(response: &Http<'_>, installed: [u64; 3], now: u64) -> Option<Check> {
    response.unavailable(now).or_else(|| match response.status {
        301 | 302 | 303 | 307 | 308 => classify(redirected_tag(response.header("Location")?)?, installed),
        _ => None,
    })
}

fn interpret_api(response: &Http<'_>, installed: [u64; 3], now: u64) -> Check {
    if let Some(status) = response.unavailable(now) {
        return status;
    }
    if response.status != 200 {
        return Check::Failed;
    }
    let Ok(release) = serde_json::from_str::<GitHubRelease>(response.body) else {
        return Check::Failed;
    };
    if release.draft
        || release.prerelease
        || !release.html_url.starts_with("https://github.com/")
        || redirected_tag(&release.html_url) != Some(release.tag_name.as_str())
    {
        return Check::Failed;
    }
    #[cfg(windows)]
    if !release.assets.iter().any(|asset| {
        asset.state == "uploaded" && asset.size > 0 && asset.name.ends_with("_x64-setup.exe")
    }) {
        return Check::Unpublished;
    }
    classify(&release.tag_name, installed).unwrap_or(Check::Failed)
}

#[cfg(any(not(windows), test))]
fn resolve_latest(page: Option<Check>, api: impl FnOnce() -> Option<Check>) -> Check {
    match page {
        Some(status @ (Check::Available { .. } | Check::Current)) => status,
        _ => match api() {
            Some(status) if status != Check::Failed => status,
            _ => match page {
                Some(status @ Check::RateLimited { .. }) => status,
                _ => Check::Failed,
            },
        },
    }
}

fn request(url: &str, head: bool) -> Option<String> {
    #[cfg(windows)]
    let mut command = Command::new(std::path::PathBuf::from(std::env::var_os("SystemRoot")?)
        .join("System32").join("curl.exe"));
    #[cfg(not(windows))]
    let mut command = Command::new("/usr/bin/curl");
    command.args(["-q", "--silent", "--show-error", "--suppress-connect-headers",
        "--proto", "=https", "--connect-timeout", "5", "--max-time", "9",
        "--max-filesize", "1048576", "--max-redirs", "0", "--header", "Cache-Control: no-cache",
        "--user-agent", "Any2WebP update checker"]);
    if head {
        command.arg("--head");
    } else {
        command.args(["--include", "--header", "Accept: application/vnd.github+json"]);
    }
    command.arg(url);
    String::from_utf8(run_process(command, "GitHub Releases", 10, None).ok()?).ok()
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> AppResult<Check> {
    let current = &app.package_info().version;
    let installed = [current.major, current.minor, current.patch];
    worker(move || {
        let now = || SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let api = || request(API_URL, false).and_then(|data| {
            Some(interpret_api(&Http::parse(&data)?, installed, now()))
        });
        #[cfg(windows)]
        let status = api().unwrap_or(Check::Failed);
        #[cfg(not(windows))]
        let page = request(LATEST_URL, true)
            .and_then(|data| interpret_latest(&Http::parse(&data)?, installed, now()));
        #[cfg(not(windows))]
        let status = resolve_latest(page, api);
        Ok(status)
    }).await
}

#[tauri::command]
pub async fn open_update_page(tag: String) -> AppResult<()> {
    let path = release_path(&tag).ok_or("ui:updateFailed")?;
    let url = format!("https://github.com{path}");
    #[cfg(windows)]
    return worker(move || crate::windows_platform::open_url(&url)
        .map_err(|_| "ui:updateFailed".into())).await;
    #[cfg(not(windows))]
    worker(move || {
        let mut command = Command::new("/usr/bin/open");
        command.arg(url);
        run_process(command, "GitHub", 10, None).map(|_| ())
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const CURRENT: [u64; 3] = [0, 2, 13];

    #[test]
    fn api_can_find_release_when_latest_page_is_unavailable() {
        let available = || Some(Check::Available { tag: "v0.3.0".to_owned() });
        assert!(matches!(resolve_latest(Some(Check::Unpublished), available), Check::Available { .. }));
        assert_eq!(resolve_latest(Some(Check::Unpublished), || Some(Check::Unpublished)), Check::Unpublished);
        assert_eq!(resolve_latest(Some(Check::Unpublished), || None), Check::Failed);
        assert_eq!(resolve_latest(Some(Check::Current), || panic!("an official redirect needs no fallback")), Check::Current);
    }

    #[test]
    fn stable_numeric_tags_and_only_our_release_redirects() {
        for (location, expected) in [
            ("https://github.com/ixiehao/Any2WebP/releases/tag/v0.3.0", Some("v0.3.0")),
            ("/ixiehao/Any2WebP/releases/tag/1.0.0", Some("1.0.0")),
            ("https://github.com/ixiehao/Any2WebP/releases/tag/v0.3.0-rc.1", None),
            ("https://github.com/another/Any2WebP/releases/tag/v0.3.0", None),
            ("https://github.com.evil.invalid/ixiehao/Any2WebP/releases/tag/v0.3.0", None),
            ("https://github.com/ixiehao/Any2WebP/releases/tag/v0.3.0?other", None),
        ] {
            assert_eq!(redirected_tag(location), expected);
        }
        assert_eq!(classify("v0.2.10", CURRENT), Some(Check::Current));
        assert_eq!(classify("v0.2.13", CURRENT), Some(Check::Current));
        assert_eq!(classify("v0.2.14", CURRENT), Some(Check::Available { tag: "v0.2.14".into() }));
        assert_eq!(classify("v0.02.14", CURRENT), None);
        assert_eq!(release_path("v0.2.14").as_deref(), Some("/ixiehao/Any2WebP/releases/tag/v0.2.14"));
        assert_eq!(release_path("v0.2.14?redirect"), None);
    }

    #[test]
    fn distinguishes_unpublished_and_rate_limits_and_uses_both_headers() {
        let none = Http::parse("HTTP/2 404\r\n\r\n").unwrap();
        assert_eq!(interpret_latest(&none, CURRENT, 100), Some(Check::Unpublished));
        let rate = Http::parse("HTTP/2 403\r\nretry-after: 30\r\nx-ratelimit-reset: 180\r\n\r\n").unwrap();
        assert_eq!(interpret_latest(&rate, CURRENT, 100), Some(Check::RateLimited { retry_at: 180 }));
        let retry_date = Http::parse("HTTP/2 429\r\nRetry-After: Thu, 01 Jan 1970 00:03:00 GMT\r\n\r\n").unwrap();
        assert_eq!(retry_date.unavailable(100), Some(Check::RateLimited { retry_at: 180 }));
    }

    #[test]
    fn api_fallback_rejects_drafts_prereleases_and_foreign_urls() {
        for (draft, prerelease, host, expected) in [
            (false, false, "github.com", Check::Available { tag: "v0.2.14".into() }),
            (true, false, "github.com", Check::Failed),
            (false, true, "github.com", Check::Failed),
            (false, false, "github.com.invalid", Check::Failed),
        ] {
            let response = format!(concat!(
                "HTTP/2 200\r\n\r\n",
                "{{\"tag_name\":\"v0.2.14\",\"html_url\":\"https://{}/ixiehao/Any2WebP/releases/tag/v0.2.14\",",
                "\"draft\":{},\"prerelease\":{},",
                "\"assets\":[{{\"name\":\"Any2WebP.Preview_0.2.14_x64-setup.exe\",\"state\":\"uploaded\",\"size\":1024}}]}}"
            ), host, draft, prerelease);
            assert_eq!(interpret_api(&Http::parse(&response).unwrap(), CURRENT, 100), expected);
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_requires_an_uploaded_x64_installer() {
        for (name, state, size) in [
            ("Any2WebP_0.3.0_aarch64.dmg", "uploaded", 1024),
            ("Any2WebP_0.3.0_arm64-setup.exe", "uploaded", 1024),
            ("Any2WebP_0.3.0_x64-setup.exe", "starter", 1024),
            ("Any2WebP_0.3.0_x64-setup.exe", "uploaded", 0),
        ] {
            let response = format!(concat!(
                "HTTP/2 200\r\n\r\n",
                "{{\"tag_name\":\"v0.3.0\",\"html_url\":\"https://github.com/ixiehao/Any2WebP/releases/tag/v0.3.0\",",
                "\"draft\":false,\"prerelease\":false,",
                "\"assets\":[{{\"name\":\"{}\",\"state\":\"{}\",\"size\":{}}}]}}"
            ), name, state, size);
            assert_eq!(interpret_api(&Http::parse(&response).unwrap(), CURRENT, 100), Check::Unpublished);
        }
    }
}
