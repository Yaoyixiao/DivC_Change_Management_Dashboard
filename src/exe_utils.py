"""PyInstaller 打包入口共用的小工具：控制台容错与双击暂停。

只在 frozen（exe）模式下生效；源码方式运行时是空操作。
"""
from __future__ import annotations
import sys


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def make_streams_tolerant() -> None:
    """控制台代码页不含的字符替换为 ?，避免 print/logging 触发 UnicodeEncodeError 崩溃。"""
    if not is_frozen():
        return
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(errors="replace")
            except (ValueError, OSError):
                pass


def pause_if_frozen() -> None:
    """双击 exe 运行结束时停留，让用户能看到结果或报错再关窗口。"""
    if not is_frozen():
        return
    try:
        input("\n按回车键退出...")
    except (EOFError, KeyboardInterrupt, OSError):
        pass
