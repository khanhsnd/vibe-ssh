/// Hộp chọn file khóa riêng (PEM / OpenSSH). `null` = người dùng đóng hộp thoại.
export async function pickKeyFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ title: "Chọn file PEM / khóa riêng SSH", directory: false, multiple: false });
  return typeof res === "string" ? res : null;
}
