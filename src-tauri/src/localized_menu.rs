use crate::AppResult;
use core_foundation::{array::CFArray, base::TCFType, string::CFString};
use core_foundation_sys::locale::CFLocaleCopyPreferredLanguages;
use serde::Deserialize;
use tauri::{
    menu::{AboutMetadata, CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem as Item, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID},
    AppHandle, Emitter,
};

#[tauri::command]
pub fn system_languages() -> Vec<String> {
    // The system returns an owned array of CFString language identifiers.
    let languages = unsafe {
        let array = CFLocaleCopyPreferredLanguages();
        if array.is_null() {
            return Vec::new();
        }
        CFArray::<CFString>::wrap_under_create_rule(array)
    };
    languages.iter().map(|language| language.to_string()).collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct MenuLabels {
    about: String,
    check_updates: String,
    dependency_check: String,
    hide: String,
    hide_others: String,
    services: String,
    quit: String,
    file: String,
    add_files: String,
    edit: String,
    undo: String,
    redo: String,
    cut: String,
    copy: String,
    paste: String,
    select_all: String,
    view: String,
    language: String,
    follow_system: String,
    window: String,
    minimize: String,
    zoom: String,
    close: String,
    full_screen: String,
    help: String,
}

const LANGUAGE_CHOICES: [(&str, &str); 4] = [
    ("system", ""),
    ("zh-CN", "简体中文"),
    ("en", "English"),
    ("ja", "日本語"),
];

fn build(app: &AppHandle, labels: &MenuLabels, preference: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("Any2WebP".into()),
        version: Some(app.package_info().version.to_string()),
        icon: app.default_window_icon().cloned(),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(app, "Any2WebP", true, &[
        &Item::about(app, Some(&labels.about), Some(about))?,
        &MenuItem::with_id(app, "check-updates", format!("{}…", labels.check_updates), true, None::<&str>)?,
        &Item::separator(app)?,
        &Item::services(app, Some(&labels.services))?,
        &Item::separator(app)?,
        &Item::hide(app, Some(&labels.hide))?,
        &Item::hide_others(app, Some(&labels.hide_others))?,
        &Item::separator(app)?,
        &Item::quit(app, Some(&labels.quit))?,
    ])?;
    let file = Submenu::with_items(app, &labels.file, true, &[
        &MenuItem::with_id(app, "add-files", format!("{}…", labels.add_files), true, Some("CmdOrCtrl+O"))?,
        &Item::separator(app)?,
        &Item::close_window(app, Some(&labels.close))?,
    ])?;
    let edit = Submenu::with_items(app, &labels.edit, true, &[
        &Item::undo(app, Some(&labels.undo))?,
        &Item::redo(app, Some(&labels.redo))?,
        &Item::separator(app)?,
        &Item::cut(app, Some(&labels.cut))?,
        &Item::copy(app, Some(&labels.copy))?,
        &Item::paste(app, Some(&labels.paste))?,
        &Item::select_all(app, Some(&labels.select_all))?,
    ])?;
    let view = Submenu::with_items(app, &labels.view, true, &[
        &Item::fullscreen(app, Some(&labels.full_screen))?,
    ])?;
    let language = Submenu::with_items(app, &labels.language, true, &[])?;
    for (choice, label) in LANGUAGE_CHOICES {
        let label = if choice == "system" { &labels.follow_system } else { label };
        language.append(&CheckMenuItem::with_id(app, format!("language:{choice}"), label,
            true, choice == preference, None::<&str>)?)?;
    }
    let window = Submenu::with_id_and_items(app, WINDOW_SUBMENU_ID, &labels.window, true, &[
        &Item::minimize(app, Some(&labels.minimize))?,
        &Item::maximize(app, Some(&labels.zoom))?,
        &Item::separator(app)?,
        &Item::close_window(app, Some(&labels.close))?,
    ])?;
    let help = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, &labels.help, true, &[
        &MenuItem::with_id(app, "video-dependencies", format!("{}…", labels.dependency_check), true, None::<&str>)?,
    ])?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &language, &window, &help])
}

#[tauri::command]
pub fn set_menu_language(app: AppHandle, labels: MenuLabels, preference: String) -> AppResult<()> {
    build(&app, &labels, &preference)
        .and_then(|menu| app.set_menu(menu))
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id: &str = event.id().as_ref();
    let action = if matches!(id, "add-files" | "check-updates" | "video-dependencies") { id }
        else if let Some(choice) = id.strip_prefix("language:") { choice }
        else { return };
    let _ = app.emit("app-menu-action", action);
}
