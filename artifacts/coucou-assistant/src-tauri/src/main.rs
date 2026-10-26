#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, PhysicalPosition};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("island") {
                if let Some(monitor) = window.primary_monitor()? {
                    let monitor_position = monitor.position();
                    let monitor_size = monitor.size();
                    let window_size = window.outer_size()?;
                    let x = monitor_position.x
                        + monitor_size.width.saturating_sub(window_size.width) as i32 / 2;
                    let y = monitor_position.y
                        + (12.0 * monitor.scale_factor()).round() as i32;
                    window.set_position(PhysicalPosition::new(x, y))?;
                }

                window.set_always_on_top(true)?;
                window.set_skip_taskbar(true)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run IRIS desktop app");
}