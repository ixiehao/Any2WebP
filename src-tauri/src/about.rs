use objc2::{runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{
    NSAboutPanelOptionCredits, NSAboutPanelOptionVersion, NSApplication, NSColor, NSFont,
    NSFontAttributeName, NSForegroundColorAttributeName, NSLinkAttributeName,
    NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSTextAlignment,
};
use objc2_foundation::{
    ns_string, NSDictionary, NSMutableAttributedString, NSAttributedString, NSString, NSURL,
};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::AppHandle;

const REPOSITORY: &str = "https://github.com/ixiehao/Any2WebP";
const DEVELOPER: &str = "https://github.com/ixiehao";
const ISSUES: &str = "https://github.com/ixiehao/Any2WebP/issues/new/choose";
const LICENSE: &str = "https://github.com/ixiehao/Any2WebP/blob/main/LICENSE";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Labels {
    locale: String,
    description: String,
    developer: String,
    website: String,
    feedback: String,
    local_processing: String,
    license: String,
}

#[derive(Default)]
pub(crate) struct AboutPanel(Mutex<Option<Labels>>);

impl AboutPanel {
    pub(crate) fn set_labels(&self, labels: Labels) {
        *self.0.lock().expect("about panel labels lock") = Some(labels);
    }

    pub(crate) fn show(&self, app: &AppHandle) {
        let labels = self.0.lock().expect("about panel labels lock").clone();
        let _ = app.run_on_main_thread(move || {
            let mtm = MainThreadMarker::new().expect("about panel opens on the main thread");
            let application = NSApplication::sharedApplication(mtm);
            let Some(labels) = labels else {
                application.orderFrontStandardAboutPanel(None);
                return;
            };
            let credits = credits(&labels);
            // An empty build label avoids repeating the short version from Info.plist.
            let values: [&AnyObject; 2] = [&credits, ns_string!("")];
            let options = unsafe {
                NSDictionary::from_slices(
                    &[NSAboutPanelOptionCredits, NSAboutPanelOptionVersion],
                    &values,
                )
            };
            // AppKit receives the attributed credits and an NSString build label.
            unsafe { application.orderFrontStandardAboutPanelWithOptions(&options) };
        });
    }
}

fn credits(labels: &Labels) -> objc2::rc::Retained<NSMutableAttributedString> {
    let paragraph = NSMutableParagraphStyle::new();
    paragraph.setAlignment(NSTextAlignment::Center);
    paragraph.setParagraphSpacing(5.0);
    let font = NSFont::systemFontOfSize(12.0);
    let secondary = NSColor::secondaryLabelColor();
    let link_color = NSColor::linkColor();
    let credits = NSMutableAttributedString::from_nsstring(ns_string!(""));

    let append = |text: &str, destination: Option<&str>| {
        let url = destination.and_then(|value| NSURL::URLWithString(&NSString::from_str(value)));
        let color = if url.is_some() { &link_color } else { &secondary };
        // Each AppKit attribute key is paired with its documented object type.
        unsafe {
            let mut keys = vec![NSFontAttributeName, NSForegroundColorAttributeName, NSParagraphStyleAttributeName];
            let mut values: Vec<&AnyObject> = vec![&font, color, &paragraph];
            if let Some(url) = &url {
                keys.push(NSLinkAttributeName);
                values.push(url);
            }
            let attributes = NSDictionary::from_slices(&keys, &values);
            credits.appendAttributedString(&NSAttributedString::new_with_attributes(
                &NSString::from_str(text), &attributes,
            ));
        }
    };
    let website = match labels.locale.as_str() {
        "zh-CN" => "https://ixiehao.github.io/Any2WebP/zh/",
        "ja" => "https://ixiehao.github.io/Any2WebP/ja/",
        _ => "https://ixiehao.github.io/Any2WebP/",
    };
    append(&format!("{}\n{} · ", labels.description, labels.developer), None);
    append("ixiehao", Some(DEVELOPER));
    append("\n", None);
    append(&labels.website, Some(website));
    append(" · ", None);
    append("GitHub", Some(REPOSITORY));
    append(" · ", None);
    append(&labels.feedback, Some(ISSUES));
    append(&format!("\n{}\n", labels.local_processing), None);
    append(&labels.license, Some(LICENSE));
    credits
}
