use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    os::windows::process::CommandExt,
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
pub struct Address {
    name: String,
    address: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RoomInfo {
    port: u16,
    local: String,
    addresses: Vec<Address>,
    setup: serde_json::Value,
}

#[derive(Clone, Serialize)]
pub struct HostStatus {
    supported: bool,
    revision: u64,
    busy: bool,
    room: Option<RoomInfo>,
    error: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Startup {
    Ready { room: RoomInfo },
    Error { message: String },
}

enum Request {
    Start(
        u16,
        serde_json::Value,
        mpsc::SyncSender<Result<RoomInfo, String>>,
    ),
    Stop(mpsc::SyncSender<()>),
    Shutdown,
}

/// 唯一工作线程拥有 Child 与 stdin：串行启动/关闭，界面不接触 PID 或运行时路径。
/// 父进程意外退出时，管道 EOF 由 Node 主持入口负责关闭房间。
pub struct DesktopHost {
    requests: mpsc::Sender<Request>,
    status: Arc<Mutex<HostStatus>>,
}

impl DesktopHost {
    pub fn new(app: AppHandle) -> Self {
        let (send, receive) = mpsc::channel();
        let status = Arc::new(Mutex::new(HostStatus {
            supported: true,
            revision: 0,
            busy: false,
            room: None,
            error: String::new(),
        }));
        let shared = status.clone();
        thread::spawn(move || {
            let mut child: Option<Child> = None;
            loop {
                // 空闲时阻塞等待；只有正在主持时才检查所拥有进程的退出状态。
                let request = if child.is_some() {
                    match receive.recv_timeout(Duration::from_millis(200)) {
                        Ok(request) => Some(request),
                        Err(mpsc::RecvTimeoutError::Timeout) => None,
                        Err(_) => Some(Request::Shutdown),
                    }
                } else {
                    Some(receive.recv().unwrap_or(Request::Shutdown))
                };
                match request {
                    Some(Request::Start(port, setup, reply)) => {
                        if child.is_some() {
                            let _ = reply.send(Err("请先关闭当前房间。".into()));
                            continue;
                        }
                        publish(&app, &shared, true, None, String::new());
                        match launch(&app, port, &setup) {
                            Ok((process, room)) => {
                                child = Some(process);
                                publish(&app, &shared, false, Some(room.clone()), String::new());
                                let _ = reply.send(Ok(room));
                            }
                            Err(error) => {
                                publish(&app, &shared, false, None, error.clone());
                                let _ = reply.send(Err(error));
                            }
                        }
                    }
                    Some(Request::Stop(reply)) => {
                        publish(&app, &shared, true, None, String::new());
                        if let Some(process) = child.take() {
                            close(process);
                        }
                        publish(&app, &shared, false, None, String::new());
                        let _ = reply.send(());
                    }
                    Some(Request::Shutdown) => {
                        if let Some(process) = child.take() {
                            close(process);
                        }
                        break;
                    }
                    None => {
                        let exited = child
                            .as_mut()
                            .and_then(|process| process.try_wait().ok().flatten());
                        if let Some(exit) = exited {
                            child.take();
                            publish(
                                &app,
                                &shared,
                                false,
                                None,
                                format!("主持端已停止（{exit}），可重新创建房间。"),
                            );
                        }
                    }
                }
            }
        });
        Self {
            requests: send,
            status,
        }
    }

    pub fn shutdown(&self) {
        let _ = self.requests.send(Request::Shutdown);
    }
}

fn publish(
    app: &AppHandle,
    shared: &Mutex<HostStatus>,
    busy: bool,
    room: Option<RoomInfo>,
    error: String,
) {
    let mut status = shared.lock().expect("host status lock poisoned");
    status.revision += 1;
    status.busy = busy;
    status.room = room;
    status.error = error;
    let _ = app.emit("desktop-host-changed", status.clone());
}

fn launch(
    app: &AppHandle,
    port: u16,
    setup: &serde_json::Value,
) -> Result<(Child, RoomInfo), String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("host");
    if !root.join("node.exe").is_file() || !root.join("main.mjs").is_file() {
        return Err("主持组件缺失，请重新解压完整桌面包。".into());
    }
    let mut child = Command::new(root.join("node.exe"))
        .arg(root.join("main.mjs"))
        .arg(port.to_string())
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW，仅适用于本模块创建的 Windows 子进程。
        .spawn()
        .map_err(|error| format!("无法启动主持端：{error}"))?;
    let stdout = child.stdout.take().expect("piped host stdout");
    let (send, receive) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = reader.read_line(&mut line).map(|_| line);
        let _ = send.send(result);
        // 启动后持续排空 stdout；拥有进程退出时此线程自然结束。
        let _ = std::io::copy(&mut reader, &mut std::io::sink());
    });
    // 源码和资源可能超过 Windows 命令行长度；stdin 保留到房间关闭以继续承载 EOF 所有权。
    let payload = serde_json::json!({ "setup": setup }).to_string() + "\n";
    if let Err(error) = child
        .stdin
        .as_mut()
        .expect("piped host stdin")
        .write_all(payload.as_bytes())
    {
        close(child);
        return Err(format!("无法传递房间内容：{error}"));
    }
    let startup = receive
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "主持端未能及时启动。".to_string())
        .and_then(|line| line.map_err(|error| error.to_string()))
        .and_then(|line| {
            serde_json::from_str::<Startup>(&line).map_err(|_| "主持端未能完成初始化。".to_string())
        });
    match startup {
        Ok(Startup::Ready { room }) => Ok((child, room)),
        result => {
            close(child);
            Err(match result {
                Ok(Startup::Error { message }) => message,
                Err(error) => error,
                _ => unreachable!(),
            })
        }
    }
}

fn close(mut child: Child) {
    drop(child.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    // 仅操作仍由本模块持有的 Child，绝不按外部 PID 查找或终止进程。
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn hosting_status(host: State<'_, DesktopHost>) -> HostStatus {
    host.status
        .lock()
        .expect("host status lock poisoned")
        .clone()
}

#[tauri::command]
pub async fn start_host(
    host: State<'_, DesktopHost>,
    port: u16,
    setup: serde_json::Value,
) -> Result<RoomInfo, String> {
    let (send, receive) = mpsc::sync_channel(1);
    host.requests
        .send(Request::Start(port, setup, send))
        .map_err(|_| "主持模块已关闭。".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive.recv().map_err(|_| "主持模块已关闭。".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn stop_host(host: State<'_, DesktopHost>) -> Result<(), String> {
    let (send, receive) = mpsc::sync_channel(1);
    host.requests
        .send(Request::Stop(send))
        .map_err(|_| "主持模块已关闭。".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive.recv().map_err(|_| "主持模块已关闭。".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
