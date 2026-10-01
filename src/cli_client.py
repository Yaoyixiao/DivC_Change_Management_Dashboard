"""PTC Integrity CLI 的 im exportissues 封装。"""
from __future__ import annotations
import subprocess
from pathlib import Path
from typing import Iterable
from config import CLI_HOSTNAME, CLI_PORT


def _ensure_connected() -> None:
    try:
        result = subprocess.run(
            ["im", "connect", f"--hostname={CLI_HOSTNAME}", f"--port={CLI_PORT}", "--batch"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError:
        raise RuntimeError(
            "未找到 im 命令：PTC Integrity 客户端未安装或不在 PATH 上。\n"
            "请先安装 PTC Integrity 客户端，并确认命令行里能直接运行 im。"
        ) from None
    if result.returncode != 0 and "already connected" not in result.stderr.lower():
        raise RuntimeError(
            "连接 PTC Integrity 失败。\n"
            f"stdout: {result.stdout.strip()}\n"
            f"stderr: {result.stderr.strip()}"
        )


def _run_im(subcommand: str, args: Iterable[str]) -> subprocess.CompletedProcess[str]:
    _ensure_connected()
    command = ["im", subcommand, *args]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError:
        raise RuntimeError(
            "未找到 im 命令：PTC Integrity 客户端未安装或不在 PATH 上。\n"
            "请先安装 PTC Integrity 客户端，并确认命令行里能直接运行 im。"
        ) from None
    if result.returncode != 0:
        raise RuntimeError(
            f"命令执行失败: {' '.join(command)}\n"
            f"stdout: {result.stdout.strip()}\n"
            f"stderr: {result.stderr.strip()}"
        )
    return result


def export_issues(query_definition: str, fields: list[str], output_file: str) -> Path:
    path = Path(output_file).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    args = [
        f"--hostname={CLI_HOSTNAME}", f"--port={CLI_PORT}",
        f"--queryDefinition={query_definition}", f"--fields={','.join(fields)}",
        f"--outputFile={path}", "--exportHeadings", "--noopenOutputFile",
        "--overwriteOutputFile", "--batch", "--yes",
    ]
    _run_im("exportissues", args)
    if not path.exists():
        raise RuntimeError(f"im exportissues 成功返回但未生成文件: {path}")
    return path
