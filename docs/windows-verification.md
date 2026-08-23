# Windows 真机验证清单

M4 在 macOS 上以 MockHost 完成全链路开发与测试（spec §11：Windows 真实注入只能手工验证）。以下事项需在 Windows 机器上人工验证，按序进行。

## 启动方式

### 方式 A：打包 zip 运行（推荐）

1. 从 CI 产物下载 `VideoDistiller-win64.zip`（GitHub 仓库页 → Actions → Windows Package → 对应 run 的 Artifacts；或 `gh run download`。详见 README「M13 · Windows 打包」）。
2. 解压到任意目录。
3. 双击 `run.bat`。
4. 稍等片刻，浏览器会自动打开 `http://127.0.0.1:8000`（如未自动打开，手动在浏览器地址栏输入该地址）。
5. 执行台（注入/采集）另需：安装 [AutoHotkey v2](https://www.autohotkey.com/) 并使 `AutoHotkey.exe` 在 PATH 可见——本清单第一项（F12 急停）就依赖它；仅做标注/分析可跳过。

ffmpeg/ffprobe 已内置在 zip 的 `ffmpeg/` 目录下，`run.bat` 会自动将其加入 PATH，无需另行安装或配置。后端不设 `VD_HOST`，win32 上自动选择真实 `WindowsHost`。

### 方式 B：源码方式

- 安装 [AutoHotkey v2](https://www.autohotkey.com/)，确认 `AutoHotkey.exe` 在 PATH 中可被发现（若安装仅含 `AutoHotkey64.exe`，需调整 PATH 或建别名）
- 安装含 d3d11/ddagrab 支持的 ffmpeg 构建，加入 PATH
- 后端不设 `VD_HOST`（win32 自动选 WindowsHost）

## 验证项（按序）

1. **F12 急停响应性（先于一切）**：跑一个长方案，中途按 F12——必须立即停止并释放所有按住的键。worker 主线程阻塞在 `stdin.ReadLine()` 时热键响应性未经真机验证；若不响应，需改造 worker 为非阻塞读（SetTimer 轮询）或增加 Python 端急停。**此项验证通过前不要对真实游戏执行。**
2. **键名映射与注入接受度**：`LButton`/`RButton`/`WheelDown` 及字母/数字/修饰键在目标游戏中是否被接受。合成输入（SendInput 级）可能被反作弊忽略（spec §13.3）——注入是允许失败的可选后端，脚本/宏导出才是主路径。
3. **ddagrab 采集**：`POST /api/capture/start` / `stop`（curl 流）——60fps 实际达成、多显示器行为、停止时优雅收尾、入库转码正常。
4. **Razer Synapse 导入**（spec §13.4 documented deviation）：导出的 `.razer` XML 能否被 Synapse 3 真实导入，含其对键名的接受度。
5. **端到端**：执行 → F12 / 自然结束 → 回灌 → 执行台或工作台中与人工 Take 并排对比时序（mock 链路已验，真机时序未验）。
6. **观察项**：`%TEMP%` 中 worker `.ahk` 临时文件的累积；F12 急停后 API 报"worker 已退出（可能被 F12 急停）"的提示是否清晰可循。

## macOS 侧待复验

- 屏幕录制权限缺失时 `capture/stop` 应返回结构化 `permission_denied` + 指引（系统设置 → 隐私与安全性 → 屏幕录制）。
