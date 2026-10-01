"""一键流程：先从 PTC Integrity 更新数据库，成功后生成 dashboard.html 并自动打开。

用法
----
    python src/update_all.py     # 源码方式
    UpdateAll.exe                # PyInstaller 打包后（见 packaging/）

取数失败时直接终止，不基于旧库生成网页。
"""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetcher
import generate_dashboard


def main() -> int:
    fetcher.main()
    print("\n========== 数据库已更新，开始生成网页 ==========")
    # 复用 generate_dashboard 的默认路径（frozen 时为 exe 所在目录），只追加 --open
    sys.argv = ["update_all", "--open"]
    return generate_dashboard.main()


if __name__ == "__main__":
    from exe_utils import make_streams_tolerant, pause_if_frozen
    make_streams_tolerant()
    exit_code = 0
    try:
        exit_code = main()
    except Exception:
        import traceback
        traceback.print_exc()
        exit_code = 1
    pause_if_frozen()
    sys.exit(exit_code)
