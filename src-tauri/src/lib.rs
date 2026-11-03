#[cfg(windows)]
mod desktop_host;
#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder
        .setup(|app| {
            app.manage(desktop_host::DesktopHost::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_host::hosting_status,
            desktop_host::start_host,
            desktop_host::stop_host,
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<desktop_host::DesktopHost>().shutdown();
            }
        });
    builder
        .run(tauri::generate_context!())
        .expect("failed to run sgs_ng");
}
