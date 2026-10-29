//! Current-process resident memory in KiB, excluding child processes.

#[cfg(windows)]
pub fn resident_kib() -> Option<u64> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    // SAFETY: the counters are a plain C struct with a valid all-zero value.
    // The API receives a writable pointer and its exact size. GetCurrentProcess
    // returns a pseudo-handle for this process; it must not be closed.
    let counters = unsafe {
        let mut counters: PROCESS_MEMORY_COUNTERS = zeroed();
        let size = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        counters.cb = size;
        if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) == 0 {
            return None;
        }
        counters
    };
    Some((counters.WorkingSetSize / 1024) as u64)
}

#[cfg(unix)]
pub fn resident_kib() -> Option<u64> {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

#[cfg(not(any(windows, unix)))]
pub fn resident_kib() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_current_process_memory_repeatedly() {
        // Exercise the native API on Windows, rather than parsing tasklist text.
        // Repeat to catch invalid handle ownership or buffer-lifetime mistakes.
        for _ in 0..10 {
            assert!(super::resident_kib().is_some_and(|kib| kib > 0));
        }
    }
}
