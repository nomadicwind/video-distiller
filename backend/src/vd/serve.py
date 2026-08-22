"""打包入口（M13）：`python -m vd.serve`，PyInstaller onedir exe 的启动模块。

编程式启动 uvicorn（不走 `uvicorn app:module_path` 的导入字符串形式 ——
冻结后的 exe 没有可供 uvicorn 按字符串重新 import 的模块搜索路径，必须
直接把已 import 好的 app 对象传进去）。
"""
import argparse
import threading
import webbrowser

import uvicorn

from vd.api import app


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="vd.serve")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)

    if not args.no_browser:
        url = f"http://127.0.0.1:{args.port}"
        # 必须在 uvicorn.run（阻塞）之前注册好计时器，否则永远等不到执行。
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()

    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
