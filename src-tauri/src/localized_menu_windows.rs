use crate::{about_links, windows_platform, AppResult};
use serde::Deserialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, Submenu},
    AppHandle, Emitter,
};
use windows_sys::Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME};

#[tauri::command]
pub fn system_languages() -> Vec<String> {
    let (mut count, mut size) = (0, 0);
    unsafe { GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, std::ptr::null_mut(), &mut size) };
    let mut buffer = vec![0; size as usize];
    if size == 0 || unsafe {
        GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, buffer.as_mut_ptr(), &mut size)
    } == 0 {
        return Vec::new();
    }
    buffer.split(|&unit| unit == 0).take(count as usize).map(String::from_utf16_lossy).collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct MenuLabels {
    about: String,
    file: String,
    add_files: String,
    language: String,
    follow_system: String,
    help: String,
    check_updates: String,
    dependency_check: String,
}

#[tauri::command]
pub fn set_menu_language(app: AppHandle, labels: MenuLabels, preference: String) -> AppResult<()> {
    let build = || -> tauri::Result<()> {
        let file = Submenu::with_items(&app, &labels.file, true, &[
            &MenuItem::with_id(&app, "add-files", format!("{}…", labels.add_files), true, Some("Ctrl+O"))?,
        ])?;
        let language = Submenu::with_items(&app, &labels.language, true, &[])?;
        for (choice, label) in [("system", labels.follow_system.as_str()), ("en", "English"), ("zh-CN", "简体中文"), ("ja", "日本語")] {
            language.append(&CheckMenuItem::with_id(&app, format!("language:{choice}"), label,
                true, choice == preference, None::<&str>)?)?;
        }
        let help = Submenu::with_items(&app, &labels.help, true, &[
            &MenuItem::with_id(&app, "check-updates", &labels.check_updates, true, None::<&str>)?,
            &MenuItem::with_id(&app, "video-dependencies", &labels.dependency_check, true, None::<&str>)?,
            &MenuItem::with_id(&app, "show-about", &labels.about, true, None::<&str>)?,
        ])?;
        app.set_menu(Menu::with_items(&app, &[&file, &language, &help])?).map(|_| ())
    };
    build().map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AboutLink {
    Developer,
    Website,
    Repository,
    Feedback,
    License,
}

#[tauri::command]
pub fn open_about_link(link: AboutLink, locale: String) -> AppResult<()> {
    let url = match link {
        AboutLink::Developer => about_links::DEVELOPER,
        AboutLink::Website => about_links::website(&locale),
        AboutLink::Repository => about_links::REPOSITORY,
        AboutLink::Feedback => about_links::ISSUES,
        AboutLink::License => about_links::LICENSE,
    };
    windows_platform::open_url(url)
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id: &str = event.id().as_ref();
    if let Some(action) = id.strip_prefix("language:")
        .or_else(|| matches!(id, "add-files" | "show-about" | "check-updates" | "video-dependencies").then_some(id))
    {
        let _ = app.emit("app-menu-action", action);
    }
}
