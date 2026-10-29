# Vibe SSH

Workbench terminal / SFTP / tunnel theo phong cách MobaXterm, cho **macOS** và
**Windows**. Mọi dữ liệu nằm trên máy người dùng — không có server, không telemetry.

## Stack

| Lớp | Chọn | Lý do |
|---|---|---|
| Vỏ ứng dụng | **Tauri 2** (Rust) | dùng WebView hệ điều hành, không bundle Chromium → binary và RAM nhỏ hơn Electron nhiều |
| UI | React 18 + TypeScript + Vite | không dùng UI kit, không dùng icon library — CSS và icon tự viết |
| Terminal | xterm.js + WebGL addon | render nhanh, hỗ trợ unicode 11 |
| SSH | `russh` (Rust thuần) | không cần OpenSSL/libssh2, hỗ trợ X11 channel |
| SFTP | `russh-sftp` | |
| Shell cục bộ | `portable-pty` | PTY thật trên macOS và Windows |
| Bí mật | `keyring` | macOS Keychain / Windows Credential Manager |

## Chạy & cài

### Chuẩn bị (chỉ làm một lần)

Cần **Node** và **Rust**. Xcode Command Line Tools là đủ, không cần bản Xcode đầy đủ.

```bash
xcode-select --install
```

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

Nếu dùng **fish**, thêm cargo vào PATH vĩnh viễn:

```bash
fish_add_path -U $HOME/.cargo/bin
```

Với bash/zsh thì rustup đã tự thêm vào `~/.zprofile`; mở terminal mới là có.

Kiểm tra mọi thứ đã sẵn sàng:

```bash
npm install && npm run tauri -- info
```

(`Xcode: not installed` trong kết quả là bình thường — Command Line Tools là đủ.)

### Chạy khi đang phát triển

```bash
npm run app
```

Đây là lệnh dùng hằng ngày: mở cửa sổ app thật, sửa file trong `src/` là giao
diện cập nhật ngay, sửa file trong `src-tauri/src/` thì Rust build lại và app
tự khởi động lại. Lần đầu mất vài phút vì phải biên dịch toàn bộ crate.

```bash
npm run dev
```

Chỉ chạy giao diện trên trình duyệt ở `http://localhost:5273`. Tiện để xem
nhanh bố cục và màu, nhưng **không có backend**: không SSH, không SFTP, không
terminal được. Chỉ dùng để soi CSS.

### Test

```bash
cd src-tauri && cargo test
```

Bộ test tự dựng một `sshd` thật trên loopback rồi tắt đi khi xong, không để lại
gì trên máy.

### Phát hành tự động bằng tag

Đẩy tag `vMAJOR.MINOR.PATCH` lên GitHub để tự build và tạo GitHub Release:

```bash
git tag -a v0.0.2 -m "Release v0.0.2"
git push origin v0.0.2
```

Workflow `.github/workflows/release.yml` build Windows x64 (`.exe`, `.msi`),
macOS Apple Silicon và Intel (mỗi kiến trúc một `.dmg`). Chỉ khi cả ba build
thành công, bộ cài và `SHA256SUMS.txt` mới được đưa lên GitHub Release.
Version trong npm, Cargo và cấu hình Tauri tự đồng bộ theo tag trong runner;
không cần commit tăng version trước mỗi lần phát hành. Tag như `v0.0.2-beta.1`
tạo release được đánh dấu prerelease.

GitHub Actions phải được bật trong repository. Workflow dùng `GITHUB_TOKEN`
tự cấp với quyền `contents: write` ở bước phát hành, không cần thêm PAT.
Các bản này chưa có chứng thư ký số Windows hoặc Apple notarization;
macOS dùng chữ ký ad-hoc mặc định của Tauri. Xem tiến trình và lỗi ở tab Actions.
Để build lại tag có sẵn, mở **Actions → Release → Run workflow**, chọn nhánh
`master`, nhập tag (ví dụ `v0.0.1`) và chạy. Bộ cài của release có sẵn sẽ được cập nhật.

### Đóng gói để cài

```bash
npm run app:build
```

Kết quả:

| Tệp | Đường dẫn |
|---|---|
| App | `src-tauri/target/release/bundle/macos/Vibe SSH.app` |
| Bộ cài | `src-tauri/target/release/bundle/dmg/Vibe SSH_0.0.1_aarch64.dmg` |

Cài: mở `.dmg` rồi kéo **Vibe SSH** vào Applications. Hoặc chép thẳng:

```bash
cp -R "src-tauri/target/release/bundle/macos/Vibe SSH.app" /Applications/
```

Trên Windows chạy đúng `npm run app:build`, ra `.msi` và bộ cài NSIS trong
`src-tauri/target/release/bundle/`.

**Về chữ ký:** app chỉ được ký ad-hoc (`adhoc, linker-signed`), không có
Developer ID. Trên máy bạn — nơi vừa build ra — mở bình thường. Nhưng nếu gửi
`.dmg` cho máy khác, macOS sẽ chặn với thông báo "không xác minh được nhà phát
triển". Người nhận phải chuột phải vào app → **Open**, hoặc gỡ cờ cách ly:

```bash
xattr -dr com.apple.quarantine "/Applications/Vibe SSH.app"
```

Muốn phân phối tử tế thì cần tài khoản Apple Developer để ký và notarize.

## Tính năng đã cài đặt

**Giao thức**

| | |
|---|---|
| SSH | agent → khóa → mật khẩu → keyboard-interactive, thử theo thứ tự bạn đặt |
| SFTP | duyệt, sửa quyền, truyền file **và cả thư mục** |
| Telnet | tự cài đặt (RFC 854 + TTYPE/NAWS/SGA/ECHO), không gọi binary ngoài |
| Serial | RS-232 / USB-UART, chọn baud, khung, flow control |
| Mosh | chạy qua `mosh` cài trên máy, cổng và khóa truyền qua `--ssh` |
| Shell cục bộ | zsh/bash trên macOS, PowerShell trên Windows |
| RDP / VNC | chuyển sang ứng dụng mặc định của hệ thống (không nhúng) |

**Kết nối**
- Chuỗi bastion / ProxyJump nhiều chặng (tối đa 4)
- Xác minh host key có hỏi người dùng, lưu fingerprint SHA256 riêng; nhập được từ `~/.ssh/known_hosts`
- Nhập mật khẩu vào ô là tự lưu vào keychain hệ thống; để trống thì hỏi mỗi lần kết nối
- Bấm một lần vào session đang mở là nhảy tới nó; double-click mới mở thêm phiên
- Keepalive, nén zlib, TERM tuỳ chọn, biến môi trường, lệnh chạy tự động sau khi vào shell
- Nhập session từ `~/.ssh/config`
- Chế độ portable: đặt `VIBE_SSH_DATA_DIR` để mọi cấu hình nằm trong thư mục bạn chọn

**Terminal**
- Tab + chia pane: 1, 2 dọc, 2 ngang, lưới 2×2
- Multi-exec: gõ một lần, gửi tới nhiều pane đã chọn
- Macro/snippet gửi một cú nhấp
- Tìm trong màn hình (`⌘F`), copy khi bôi đen, chuột phải để dán
- Ghi log phiên ra file

**SFTP**
- Bảng thư mục xa tự mở khi SSH vào và **đi theo `cd` trong terminal** (qua OSC 7)
- Xem nội dung file văn bản ngay trong bảng, không cần tải về
- Duyệt, breadcrumb, sắp xếp, lọc
- Tạo thư mục, đổi tên, xóa đệ quy, `chmod`, đọc symlink
- Tải lên / tải xuống **file lẻ hoặc cả cây thư mục**, có tiến độ tính trên tổng dung lượng
- Kéo file hoặc thư mục từ Finder/Explorer vào để tải lên

**Tunnel**
- Local (`-L`), remote (`-R`), dynamic SOCKS5 (`-D`)
- Tự chạy khi session kết nối

**Khác**
- X11 forwarding và agent forwarding
- Keychain hệ điều hành cho mật khẩu / passphrase
- 3 theme: tối, sáng, tương phản cao; chọn thẳng từ thanh tiêu đề, không bấm mù xoay vòng
- Theme tương phản cao dùng nền đen + xanh băng (12,3:1) thay vì vàng chói —
  vẫn vượt xa ngưỡng AAA 7:1; vàng chỉ còn dành cho cảnh báo
- Mọi cặp màu chữ/nền đều được tính tỉ số tương phản, không ước lượng bằng mắt
- Bảng lệnh `⌘K` — popup duy nhất trong app, mọi thứ khác là inline

## Giới hạn còn lại

| Thứ | Trạng thái |
|---|---|
| Mosh | cần `mosh` cài sẵn trên máy — app không tự cài đặt giao thức SSP |
| RDP / VNC | chuyển sang ứng dụng mặc định của hệ thống, không nhúng cửa sổ |
| X server kèm theo | không — cần XQuartz (macOS) hoặc VcXsrv/Xming (Windows) đang chạy |
| Bộ công cụ UNIX kèm theo (kiểu Cygwin của MobaXterm) | không |
| Agent forwarding trên Windows | chưa — cần chuyển tiếp qua named pipe, hiện chỉ có unix socket |
| Kéo file từ bảng SFTP ra Finder/Explorer | không — webview không làm được drag source; chiều ngược lại (kéo vào) thì có |
| Sửa file xa tại chỗ | chỉ xem được; sửa thì tải về, sửa, rồi tải lên |

## Phím tắt

| Phím | Việc |
|---|---|
| `⌘K` / `Ctrl K` | bảng lệnh |
| `⌘T` | tab mới |
| `⌘W` | đóng tab |
| `⌘D` / `⌘⇧D` | chia pane dọc / ngang |
| `⌘B` | ẩn/hiện sidebar |
| `⌘E` | ẩn/hiện SFTP |
| `⌘⇧I` | bật/tắt multi-exec |
| `⌘1`…`⌘9` | chuyển tab |
| `⌘F` | tìm trong terminal |

## Dữ liệu lưu ở đâu

- Cấu hình: `~/Library/Application Support/VibeSSH/config.json` (macOS) ·
  `%APPDATA%\VibeSSH\config.json` (Windows)
- Host key đã tin: `known_hosts.json` cùng thư mục
- Mật khẩu / passphrase: keychain hệ điều hành, **không** nằm trong file cấu hình
- Log phiên: thư mục cấu hình được trong Cài đặt (mặc định `~/VibeSSH-logs`)

## Số đo thực tế (macOS 15.3, Apple Silicon)

| Chỉ số | Giá trị |
|---|---|
| `Vibe SSH.app` | **3,9 MB** |
| `.dmg` | **2,56 MB** |
| Bundle JS (gzip) | 190 KB |

RAM đo bằng `vmmap --summary` (physical footprint — đúng con số Activity Monitor
hiển thị), cộng tiến trình chính với đúng ba tiến trình WebKit của app:

| Trạng thái | Tổng | Chi tiết |
|---|---|---|
| Vừa mở, 1 tab trống | **≈ 76 MB** | 22 chính + 35 WebContent + 14 GPU + 5 Networking |
| Sau vài phút dùng thật, nhiều terminal mở | **≈ 161 MB** | 27 chính + 104 WebContent + 24 GPU + 6 Networking |

Phần WebContent tăng theo số terminal đang mở: mỗi terminal giữ scrollback và một
texture atlas WebGL. Tắt **Tăng tốc WebGL** trong Cài đặt sẽ giảm phần này, đổi
lại vẽ chậm hơn. WebKit là tiến trình hệ thống dùng chung, không phải Chromium
đóng gói riêng như Electron.

## Đã kiểm chứng những gì

`cargo test` — **35 test, chạy lặp lại ổn định trong ~1 giây**. Bộ test tự dựng
một `sshd` thật trên loopback (cổng trống, khóa sinh riêng, chạy dưới quyền user
thường) rồi dùng chính code của app để kết nối, nên đường SSH được kiểm tra thật
chứ không phải mock. Nếu máy không dựng được `sshd` thì các test đó tự bỏ qua.

**SSH / SFTP / tunnel — đầu-cuối với server thật**

| Test | Kiểm gì |
|---|---|
| `connects_with_key_and_runs_a_command` | xác thực ed25519, mở shell, `echo` về đúng qua `term:data` |
| `connects_with_rsa_key` | nhánh thương lượng `rsa-sha2-*` |
| `connects_through_a_bastion` | chuỗi jump: direct-tcpip + `connect_stream`, shell chạy qua bastion |
| `asks_before_trusting_an_unknown_host_key` | vòng hỏi/đáp host key, fingerprint SHA256, ghi nhớ |
| `rejects_unknown_host_key_in_strict_mode` | chế độ strict từ chối, không hỏi |
| `sftp_round_trip` | mkdir → upload 72 KB → list → chmod 600 → đọc nội dung → download → rename → xóa đệ quy |
| `sftp_transfers_whole_directories` | upload và download cả cây thư mục 3 tầng |
| `local_forward_carries_traffic` | `-L`: banner SSH đi hết đường hầm |
| `dynamic_socks5_proxy_connects` | `-D`: bắt tay SOCKS5, CONNECT, rồi truyền dữ liệu |
| `remote_forward_reaches_back` | `-R`: server bind cổng, dữ liệu về tới listener cục bộ |

**Terminal, Telnet, Serial**

| Test | Kiểm gì |
|---|---|
| `shell_output_reaches_the_frontend` | PTY thật → base64 → sự kiện `term:data` |
| `resize_reaches_the_pty` | resize → `stty size` trả về đúng 133×41 |
| `negotiates_then_carries_data_both_ways` | Telnet với server thật: TTYPE, NAWS 132×43, dữ liệu hai chiều, Enter thành CR LF |
| 8 test NVT | lọc IAC, IAC tách giữa hai lần đọc, từ chối option lạ, mã hoá dữ liệu ra |
| `lists_ports_without_error` | liệt kê cổng serial (máy này thấy 4 cổng) |

**Logic riêng của Windows** — không cross-compile được từ macOS (thiếu Windows
SDK), nên phần quyết định được tách khỏi khối `#[cfg(windows)]` để test ngay ở đây:

| Test | Kiểm gì |
|---|---|
| `picks_sensible_default_shells` | chọn shell: `$SHELL -l` trên Unix; pwsh7 → ComSpec → powershell.exe trên Windows |
| `adds_windows_extensions` | tìm chương trình theo `PATHEXT` |
| `reads_tasklist_memory_column` | đọc RAM từ CSV của `tasklist`, có dấu phẩy phân cách nghìn |
| `expands_home_prefix` | `~/` và `~\` |

Bộ giải base64 phía frontend được đối chiếu với `Buffer.from(...,'base64')` trên
600 trường hợp, đủ mọi độ dài mod 4. Giao diện được xem và sửa trực tiếp ở cả ba
theme, ở đúng kích thước cửa sổ mặc định.

**Vẫn chưa kiểm chứng:** app chưa được build và chạy trên Windows thật. Mọi
nhánh `#[cfg(windows)]` đều có mặt và phần logic đã được test như trên, nhưng
khoảng 6 dòng gọi API riêng của Windows (named pipe cho ssh-agent, Pageant, dò
đường dẫn pwsh) chưa từng được biên dịch. Cả `serialport` trên Windows cũng vậy.

## Ghi chú kỹ thuật

- Xác thực SSH chạy trên một runtime `current_thread` riêng: `russh` dựng future
  cho `Signer` (ssh-agent) mà không đảm bảo `Send`, nên không đặt được trực tiếp
  trong future của lệnh Tauri.
- Dữ liệu terminal được gộp ~6 ms hoặc 24 KB một lần rồi truyền base64 để không
  làm ngập kênh IPC khi output dồn dập.
- Handler SSH giữ một `Asker` thay vì `Arc<AppState>`; giữ `AppState` sẽ tạo vòng
  `AppState → SshConn → Handle<Client> → Client → AppState` và làm future mất `Send`.
- CSS không dùng `color-mix()`: WKWebView trên macOS 11–15 chưa hỗ trợ, các viền
  pha màu sẽ biến mất. Màu viền được khai báo thành token riêng cho từng theme.
- Kéo cửa sổ dùng thuộc tính `data-tauri-drag-region` (không phải
  `-webkit-app-region` của Electron).
- `russh` dùng backend `ring` thay vì `aws-lc-rs` mặc định: build trên Windows
  chỉ cần MSVC, không cần thêm NASM.
- Lớp SSH/PTY/Telnet/Serial không phụ thuộc Tauri — chúng nói với giao diện qua
  `Ui` (một sink sự kiện + kênh hỏi/đáp). Nhờ vậy test dựng được `Ui` đọc qua
  channel, không cần cửa sổ nào.
