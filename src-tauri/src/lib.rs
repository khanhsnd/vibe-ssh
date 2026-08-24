mod commands;
mod error;
mod hostkeys;
mod pty;
mod secrets;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod serial;
mod ssh;
mod sshconfig;
mod state;
mod store;
mod telnet;
mod termio;
mod ui;

#[cfg(test)]
mod sshfixture;
#[cfg(test)]
mod tests_pty;
#[cfg(test)]
mod tests_ssh;
#[cfg(test)]
mod tests_telnet;

use state::AppState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::store_read,
            commands::store_write,
            commands::data_dir,
            commands::secret_set,
            commands::secret_get,
            commands::secret_delete,
            commands::answer,
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::shell_open,
            commands::telnet_open,
            commands::serial_ports,
            commands::serial_open,
            commands::pty_open,
            commands::term_write,
            commands::term_write_b64,
            commands::term_broadcast,
            commands::term_resize,
            commands::term_close,
            commands::sftp_list,
            commands::sftp_home,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_chmod,
            commands::sftp_remove,
            commands::sftp_readlink,
            commands::sftp_read_text,
            commands::sftp_download,
            commands::sftp_upload,
            commands::tunnel_start,
            commands::tunnel_stop,
            commands::hostkeys_list,
            commands::hostkey_forget,
            commands::hostkeys_import,
            commands::ssh_config_import,
            commands::local_keys,
            commands::read_env,
            commands::which_bin,
            commands::mem_usage,
        ])
        .run(tauri::generate_context!())
        .expect("không khởi động được cửa sổ ứng dụng");
}
