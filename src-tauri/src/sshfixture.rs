//! Dựng một `sshd` thật trên loopback để test đường SSH/SFTP/tunnel đầu-cuối.
//!
//! Chạy dưới quyền user thường, chỉ nghe 127.0.0.1 ở cổng trống, xác thực bằng
//! khóa công khai sinh riêng cho lần chạy. Nếu máy không có `sshd` hoặc không
//! khởi động được thì fixture trả `None` và test tự bỏ qua thay vì fail.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub struct Sshd {
    pub port: u16,
    pub user: String,
    pub client_key: PathBuf,
    pub client_key_rsa: PathBuf,
    pub dir: PathBuf,
    child: Option<Child>,
}

impl Drop for Sshd {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Một server cho mỗi test. Cố tình KHÔNG dùng `OnceLock`: giá trị trong static
/// không bao giờ được drop khi tiến trình test kết thúc, nên sshd sẽ rò ra ngoài
/// máy người dùng. Khởi động chỉ mất vài chục ms nên trả giá này là rẻ.
pub fn spawn() -> Option<Sshd> {
    start()
}

fn free_port() -> Option<u16> {
    let l = TcpListener::bind("127.0.0.1:0").ok()?;
    let p = l.local_addr().ok()?.port();
    drop(l);
    Some(p)
}

fn keygen(path: &PathBuf, kind: &str) -> bool {
    Command::new("ssh-keygen")
        .args(["-q", "-t", kind, "-N", "", "-f"])
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn start() -> Option<Sshd> {
    let sshd = ["/usr/sbin/sshd", "/usr/local/sbin/sshd", "/opt/homebrew/sbin/sshd"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.exists())?;
    let sftp = ["/usr/libexec/sftp-server", "/usr/lib/openssh/sftp-server", "/usr/libexec/openssh/sftp-server"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.exists())?;

    // Mỗi fixture một thư mục riêng: nhiều test trong cùng tiến trình không đụng nhau.
    let dir = std::env::temp_dir().join(format!("vibe-ssh-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).ok()?;

    let host_key = dir.join("hostkey");
    let client_key = dir.join("clientkey");
    let client_key_rsa = dir.join("clientkey_rsa");
    if !keygen(&host_key, "ed25519") || !keygen(&client_key, "ed25519") || !keygen(&client_key_rsa, "rsa") {
        return None;
    }

    let authorized = dir.join("authorized_keys");
    let mut keys = std::fs::read_to_string(client_key.with_extension("pub")).ok()?;
    keys.push_str(&std::fs::read_to_string(client_key_rsa.with_extension("pub")).ok()?);
    std::fs::write(&authorized, keys).ok()?;

    let port = free_port()?;
    let cfg = dir.join("sshd_config");
    std::fs::write(
        &cfg,
        format!(
            "ListenAddress 127.0.0.1\n\
             Port {port}\n\
             HostKey {hk}\n\
             AuthorizedKeysFile {ak}\n\
             PidFile {pid}\n\
             StrictModes no\n\
             UsePAM no\n\
             PasswordAuthentication no\n\
             KbdInteractiveAuthentication no\n\
             PubkeyAuthentication yes\n\
             AllowTcpForwarding yes\n\
             PermitTunnel no\n\
             X11Forwarding no\n\
             PrintMotd no\n\
             Subsystem sftp {sftp}\n",
            hk = host_key.display(),
            ak = authorized.display(),
            pid = dir.join("sshd.pid").display(),
            sftp = sftp.display(),
        ),
    )
    .ok()?;

    let child = Command::new(&sshd)
        .arg("-f")
        .arg(&cfg)
        .args(["-D", "-e"])
        .stdout(Stdio::null())
        .stderr(std::fs::File::create(dir.join("sshd.log")).ok()?)
        .spawn()
        .ok()?;

    // Chờ cổng mở.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut up = false;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            up = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let mut fixture = Sshd {
        port,
        user: std::env::var("USER").unwrap_or_else(|_| "root".into()),
        client_key,
        client_key_rsa,
        dir,
        child: Some(child),
    };
    if !up {
        // Drop sẽ kill sshd và xoá thư mục.
        fixture.child.take().map(|mut c| {
            let _ = c.kill();
            c.wait()
        });
        return None;
    }
    Some(fixture)
}
