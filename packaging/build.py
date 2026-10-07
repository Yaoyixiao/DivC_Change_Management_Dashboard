# -*- coding: utf-8 -*-
"""一键构建 4 个免 Python 环境的 exe，输出到 Release/。

用法
----
    python packaging/build.py            # 构建 + 拷贝到 Release/
    python packaging/build.py --smoke    # 构建后对 GenerateDashboard.exe 做冒烟自检

产物（Release/）
----
    UpdateDatabase.exe     取数：PTC Integrity -> output/dashboard.db（需 PTC 客户端）
    GenerateDashboard.exe  出网页：output/dashboard.db -> dashboard.html 并启动 opener
    IntegrityOpener.exe    只启动 PTC Integrity opener 服务（127.0.0.1:8766），
                           单独给"dashboard 已有但 opener 不在线"的场景用
    UpdateAll.exe          一键：先取数再出网页并自动打开
    使用说明.md
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "src"
PACKAGING = REPO / "packaging"
DIST = PACKAGING / "dist"
RELEASE = REPO / "Release"

ASSETS = str(REPO / "src" / "dashboard_generator" / "assets")  # --add-data 相对 specpath 解析，必须用绝对路径
ASSETS_DEST = "dashboard_generator/assets"

# onedir=False 产出单个 exe（方便分发）；若被杀毒软件误报，改为 True 产出同名文件夹
ONEDIR = False


# anaconda 环境的坑：openpyxl 对 numpy/PIL 是可选 try-import，PyInstaller 会把整套
# Intel MKL（约 400MB）一起打进来。取数链只用纯 Python 的 openpyxl/xlrd，这些全部排除。
EXCLUDES = ["numpy", "pandas", "scipy", "matplotlib", "PIL", "tkinter", "_tkinter"]


def run_pyinstaller(name: str, entry: str, extra: list[str]) -> None:
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--console",
        "--name", name,
        "--distpath", str(DIST),
        "--workpath", str(PACKAGING / "build"),
        "--specpath", str(PACKAGING),
        "--paths", str(SRC),
    ]
    for mod in EXCLUDES:
        cmd.extend(["--exclude-module", mod])
    if ONEDIR:
        cmd.append("--onedir")
    else:
        cmd.append("--onefile")
    cmd.extend(extra)
    cmd.append(str(SRC / entry))
    print(f"\n=== 构建 {name} ===\n{' '.join(cmd)}\n")
    subprocess.run(cmd, check=True, cwd=str(REPO))


def build() -> None:
    for module in ("openpyxl", "xlrd"):
        __import__(module)
    import PyInstaller  # noqa: F401

    run_pyinstaller("UpdateDatabase", "fetcher.py", [])
    # generate_dashboard 现在按 --serve 自动启动 opener 服务（import dashboard_opener），
    # dashboard_opener 又是 src/ 下的纯 Python 模块，PyInstaller 会自动从 --paths 抓到，
    # 不需要额外 --add-data。
    run_pyinstaller("GenerateDashboard", "generate_dashboard.py", [
        "--add-data", f"{ASSETS};{ASSETS_DEST}",
    ])
    # IntegrityOpener.exe：纯 opener 服务，没有 assets 数据需求。
    # dashboard_opener.py 在 src/ 下，与 opener_only.py 同目录，被 --paths 覆盖到。
    run_pyinstaller("IntegrityOpener", "opener_only.py", [])
    run_pyinstaller("UpdateAll", "update_all.py", [
        "--add-data", f"{ASSETS};{ASSETS_DEST}",
    ])

    RELEASE.mkdir(exist_ok=True)
    if ONEDIR:
        # onedir：每个 exe 连同它的 _internal 依赖文件夹整体拷贝
        for name in ("UpdateDatabase", "GenerateDashboard", "IntegrityOpener", "UpdateAll"):
            dst_dir = RELEASE / name
            if dst_dir.exists():
                shutil.rmtree(dst_dir)
            shutil.copytree(DIST / name, dst_dir)
    else:
        for name in ("UpdateDatabase.exe", "GenerateDashboard.exe", "IntegrityOpener.exe", "UpdateAll.exe"):
            src_path = DIST / name
            if src_path.exists():
                shutil.copy2(src_path, RELEASE / name)
    readme = PACKAGING / "使用说明.md"
    if readme.exists():
        shutil.copy2(readme, RELEASE / "使用说明.md")
    print(f"\n=== 完成，产物在 {RELEASE} ===")


def smoke() -> None:
    """两层冒烟：exe 产物自检（GenerateDashboard）+ 取数链无 PTC 自检（numpy 屏蔽模拟）。"""
    exe = RELEASE / "GenerateDashboard.exe"
    db = SRC / "output" / "dashboard.db"
    assert exe.exists(), f"缺少 {exe}"
    assert db.exists(), f"缺少 {db}"
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "smoke_dashboard.html"
        print(f"\n=== 冒烟：{exe.name} --db {db.name} ===")
        result = subprocess.run(
            [str(exe), "--db", str(db), "--out", str(out)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300,
        )
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr, file=sys.stderr)
            raise SystemExit(f"[FAIL] {exe.name} 退出码 {result.returncode}")
        html = out.read_text(encoding="utf-8")
        m = re.search(r"window\.__PAYLOAD__\s*=\s*(\{.*?\});\s*</script>", html, re.DOTALL)
        assert m, "HTML 里找不到 __PAYLOAD__"
        payload = json.loads(m.group(1))
        counts = {k: len(payload["data"][k]) for k in
                  ["ra_ops", "parent_ops", "child_ops", "deliveries", "change_requests", "builds"]}
        assert counts == {"ra_ops": 106, "parent_ops": 108, "child_ops": 657,
                          "deliveries": 178, "change_requests": 713, "builds": 370}, counts
        for k in ("kpis", "opened_closed_rates", "ra_op_time", "closed_states"):
            assert k in payload["aggregations"], k
        # 自包含：禁止自动加载的外部资源（script/img/link/iframe 等的 src/href），
        # 但允许 <a href="https://..."> —— 这是用户主动点击触发的导航，
        # 不会产生页面加载时的网络请求。判定标准：Handoff/workflow.md §1 #18
        # 「断网刷新仍能完整工作，Network 面板 0 请求」。
        externals = re.findall(
            r'<(?:script|link|img|iframe|source|audio|video)\b[^>]*?\b(?:src|href)\s*=\s*["\']https?://',
            html, re.I,
        )
        externals = [m for m in externals if 'w3.org' not in m]
        assert not externals, f"external auto-loaded resources: {externals}"
        print(f"[PASS] exe 产物自检通过，size = {len(html):,} bytes，counts = {counts}")

    print("\n=== 冒烟：取数链（numpy 屏蔽模拟 exe 环境） ===")
    result = subprocess.run(
        [sys.executable, str(PACKAGING / "selftest_fetch.py")],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300,
    )
    print(result.stdout, end="")
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise SystemExit("[FAIL] 取数链自检未通过")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="打包 3 个 exe 到 Release/")
    ap.add_argument("--smoke", action="store_true", help="构建后对 GenerateDashboard.exe 做冒烟自检")
    args = ap.parse_args()
    build()
    if args.smoke:
        smoke()
