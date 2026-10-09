"""CLI: 把 src/output/dashboard.db 渲染成单文件自包含 HTML dashboard。

用法
----
    python src/generate_dashboard.py                     # 默认输出 ./dashboard.html
    python src/generate_dashboard.py --out report.html   # 指定输出
    python src/generate_dashboard.py --open              # 生成后用默认浏览器打开
    python src/generate_dashboard.py --db path/to/db     # 指定 DB
    python src/generate_dashboard.py --serve             # 渲染完启动本地 opener 服务
                                                        # （127.0.0.1:8766），
                                                        # ID 链接 → PTC 客户端一键唤起
"""
from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from exe_utils import make_streams_tolerant, pause_if_frozen

# PyInstaller onefile 下 __file__ 指向临时解压目录（退出即删），frozen 时以 exe 所在目录为基准
if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    # 让 `from dashboard_generator.xxx import ...` 能找到兄弟包
    ROOT = Path(__file__).resolve().parent
    sys.path.insert(0, str(ROOT))

from dashboard_generator.aggregations import compute_all_aggregations  # noqa: E402
from dashboard_generator.data_loader import load_payload, summarize  # noqa: E402
from dashboard_generator.html_template import write_html  # noqa: E402


def main() -> int:
    frozen = getattr(sys, "frozen", False)
    if frozen and len(sys.argv) == 1:
        sys.argv.append("--serve")  # 双击 exe：生成后启动 opener
    out_default = str(ROOT / "dashboard.html") if frozen else "dashboard.html"
    ap = argparse.ArgumentParser(
        prog="generate_dashboard",
        description="Render dashboard.db → single-file HTML dashboard",
    )
    ap.add_argument(
        "--db",
        default=str(ROOT / "output" / "dashboard.db"),
        help="path to dashboard.db (default: src/output/dashboard.db)",
    )
    ap.add_argument(
        "--out",
        default=out_default,
        help="output HTML path (default: ./dashboard.html)",
    )
    ap.add_argument(
        "--open",
        action="store_true",
        help="open the generated HTML in default browser",
    )
    ap.add_argument(
        "--serve",
        action="store_true",
        help="after rendering, start the PTC Integrity opener HTTP service "
             "(127.0.0.1:8766) so ID clicks bypass Mimecast URL rewriting. "
             "Blocks until Ctrl+C.",
    )
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"[ERR] DB not found: {db_path}", file=sys.stderr)
        return 2

    print(f"[1/3] Loading payload from {db_path} …")
    payload = load_payload(db_path)
    counts = summarize(payload)
    print(f"      counts: {counts}")
    print(f"      generated_at: {payload.get('meta', {}).get('generated_at', 'n/a')}")

    print("[2/3] Computing aggregations …")
    aggregations = compute_all_aggregations(payload)

    print(f"[3/3] Writing {args.out} …")
    out_path = Path(args.out).resolve()
    write_html(
        {
            "data": {k: payload[k] for k in ("ecrs", "builds", "items")},
            "graph": payload["graph"],
            "aggregations": aggregations,
            "meta": payload.get("meta") or {},
        },
        out_path,
    )
    size_kb = out_path.stat().st_size / 1024
    print(f"      OK {out_path}  ({size_kb:.1f} KB)")

    if args.open:
        webbrowser.open(out_path.as_uri())

    if args.serve:
        print()
        print("[4/4] Starting PTC Integrity opener on http://127.0.0.1:8766/ …")
        print("       Click ID links in dashboard.html → opens PTC RV&S directly.")
        print("       Keep this window open. Press Ctrl+C to stop.")
        print()
        try:
            from dashboard_opener import serve
            serve()
        except KeyboardInterrupt:
            print("\n[opener] stopped")
        except ImportError as e:
            print(f"[opener] dashboard_opener module unavailable: {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
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