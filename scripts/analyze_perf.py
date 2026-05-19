#!/usr/bin/env python3
import glob
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path


def percentile(values, pct):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int((len(ordered) * pct + 99) // 100) - 1))
    return float(ordered[index])


def read_records(target):
    path = Path(target)
    files = []
    if path.is_file():
        files = [path]
    elif path.is_dir():
        files = [Path(item) for item in glob.glob(str(path / "*.jsonl"))]
    else:
        files = [Path(item) for item in glob.glob("logs/perf/*.jsonl")]

    for file_path in sorted(files):
        with file_path.open("r", encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    print(f"跳过无法解析的日志行 {file_path}:{line_no}: {exc}", file=sys.stderr)


def summarize(records):
    task_kind_counts = Counter(item.get("task_kind") or item.get("mode") or "unknown" for item in records)
    analysis_records = [
        item
        for item in records
        if (item.get("task_kind") or item.get("mode") or "collect")
        not in ("apply_output", "batch_apply", "login_prep")
    ]
    task_records = [
        item
        for item in analysis_records
        if item.get("phase") in ("task_total", "batch_total") and item.get("elapsed_ms") is not None
    ]
    if not task_records:
        task_records = [
            item
            for item in analysis_records
            if item.get("event") in ("phase", "phase_error") and item.get("task_id")
        ]

    task_by_id = {}
    for item in task_records:
        task_id = item.get("task_id") or item.get("run_id") or "<unknown>"
        current = task_by_id.get(task_id)
        if not current or float(item.get("elapsed_ms") or 0) > float(current.get("elapsed_ms") or 0):
            task_by_id[task_id] = item

    durations = [float(item.get("elapsed_ms") or 0) for item in task_by_id.values()]
    success_count = sum(1 for item in task_by_id.values() if item.get("status") in ("success", "partial", ""))
    failed_count = sum(1 for item in task_by_id.values() if item.get("status") == "error")

    phase_values = defaultdict(list)
    for item in analysis_records:
        phase = item.get("phase") or "<none>"
        if item.get("event") in ("phase", "phase_error"):
            phase_values[phase].append(float(item.get("elapsed_ms") or 0))

    slow_tasks = sorted(
        task_by_id.values(), key=lambda item: float(item.get("elapsed_ms") or 0), reverse=True
    )[:10]
    slow_phases = sorted(
        [item for item in analysis_records if item.get("event") in ("phase", "phase_error")],
        key=lambda item: float(item.get("elapsed_ms") or 0),
        reverse=True,
    )[:10]

    return {
        "total_tasks": len(task_by_id),
        "success_tasks": success_count,
        "failed_tasks": failed_count,
        "average_ms": statistics.fmean(durations) if durations else 0.0,
        "median_ms": statistics.median(durations) if durations else 0.0,
        "p90_ms": percentile(durations, 90),
        "max_ms": max(durations) if durations else 0.0,
        "phase_stats": {
            phase: {
                "average_ms": statistics.fmean(values) if values else 0.0,
                "p90_ms": percentile(values, 90),
                "count": len(values),
            }
            for phase, values in sorted(phase_values.items())
        },
        "slow_tasks": slow_tasks,
        "slow_phases": slow_phases,
        "task_kind_counts": dict(task_kind_counts),
        "filtered_task_kinds": ["apply_output", "batch_apply", "login_prep"],
    }


def print_summary(summary):
    print("总任务数:", summary["total_tasks"])
    print("成功任务数:", summary["success_tasks"])
    print("失败任务数:", summary["failed_tasks"])
    print("平均耗时(ms):", round(summary["average_ms"], 2))
    print("中位数耗时(ms):", round(summary["median_ms"], 2))
    print("p90 耗时(ms):", round(summary["p90_ms"], 2))
    print("max 耗时(ms):", round(summary["max_ms"], 2))
    print("日志 task_kind 分布:", summary["task_kind_counts"])
    print("主统计已过滤 task_kind:", ", ".join(summary["filtered_task_kinds"]))
    print()
    print("各 phase 耗时:")
    for phase, stats in summary["phase_stats"].items():
        print(
            f"  {phase}: avg={stats['average_ms']:.2f}ms "
            f"p90={stats['p90_ms']:.2f}ms count={stats['count']}"
        )
    print()
    print("最慢的 10 个 task:")
    for item in summary["slow_tasks"]:
        print(
            f"  task={item.get('task_id') or item.get('run_id')} "
            f"phase={item.get('phase')} elapsed={item.get('elapsed_ms')}ms "
            f"status={item.get('status')}"
        )
    print()
    print("最慢的 10 个 phase:")
    for item in summary["slow_phases"]:
        print(
            f"  task={item.get('task_id')} phase={item.get('phase')} "
            f"elapsed={item.get('elapsed_ms')}ms status={item.get('status')} "
            f"url={item.get('url') or ''}"
        )


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "logs/perf"
    records = list(read_records(target))
    if not records:
        print("未找到性能日志。默认读取 logs/perf/*.jsonl，也可以传入日志目录或文件。")
        return 1
    print_summary(summarize(records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
