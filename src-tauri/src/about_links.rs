pub(crate) const REPOSITORY: &str = "https://github.com/ixiehao/Any2WebP";
pub(crate) const DEVELOPER: &str = "https://github.com/ixiehao";
pub(crate) const ISSUES: &str = "https://github.com/ixiehao/Any2WebP/issues/new/choose";
pub(crate) const LICENSE: &str = "https://github.com/ixiehao/Any2WebP/blob/main/LICENSE";

pub(crate) fn website(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "https://ixiehao.github.io/Any2WebP/zh/",
        "ja" => "https://ixiehao.github.io/Any2WebP/ja/",
        _ => "https://ixiehao.github.io/Any2WebP/",
    }
}
