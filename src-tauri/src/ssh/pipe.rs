//! Nối một SSH channel với một socket cục bộ (X11, ssh-agent, remote forward).

use russh::client::Msg;
use russh::Channel;
use tokio::io::copy_bidirectional;
use tokio::net::TcpStream;

pub async fn to_tcp(channel: Channel<Msg>, host: &str, port: u16) -> std::io::Result<()> {
    let mut local = TcpStream::connect((host, port)).await?;
    let mut remote = channel.into_stream();
    copy_bidirectional(&mut remote, &mut local).await.map(|_| ())
}

#[cfg(unix)]
pub async fn to_unix(channel: Channel<Msg>, path: &str) -> std::io::Result<()> {
    let mut local = tokio::net::UnixStream::connect(path).await?;
    let mut remote = channel.into_stream();
    copy_bidirectional(&mut remote, &mut local).await.map(|_| ())
}

#[cfg(not(unix))]
pub async fn to_unix(_channel: Channel<Msg>, _path: &str) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "unix socket không khả dụng trên nền tảng này",
    ))
}

/// Nối channel X11 tới X server cục bộ dựa trên biến `DISPLAY`.
/// - `/tmp/.../org.macosforge.xquartz:0` → unix socket (macOS/XQuartz)
/// - `localhost:0` hoặc `:0`            → TCP 6000 + n (VcXsrv, XQuartz `-listen tcp`)
pub async fn to_x11(channel: Channel<Msg>, display: &str) -> std::io::Result<()> {
    if display.starts_with('/') {
        let path = display.rsplit_once(':').map(|(p, _)| p).unwrap_or(display);
        return to_unix(channel, path).await;
    }
    let (host, screen) = display.rsplit_once(':').unwrap_or(("localhost", "0"));
    let host = if host.is_empty() { "localhost" } else { host };
    let n: u16 = screen
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Trên Unix, X server thường chỉ mở unix socket → thử socket trước.
    #[cfg(unix)]
    {
        let sock = format!("/tmp/.X11-unix/X{n}");
        if std::path::Path::new(&sock).exists() {
            return to_unix(channel, &sock).await;
        }
    }
    to_tcp(channel, host, 6000 + n).await
}
