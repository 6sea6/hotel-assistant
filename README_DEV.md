# 开发版性能日志

本项目默认不启用采集性能日志。只有同时设置以下环境变量时，采集器才会加载 `devtools/perf-log.js` 并写入 JSONL：

- `HOTEL_COLLECTOR_ENV=dev`
- `ENABLE_PERF_LOG=1`

## Windows PowerShell

```powershell
$env:HOTEL_COLLECTOR_ENV = "dev"
$env:ENABLE_PERF_LOG = "1"
node scraper/src/cli.js --url "携程链接" --templateName "模板名"
```

## macOS / Linux

```bash
HOTEL_COLLECTOR_ENV=dev ENABLE_PERF_LOG=1 node scraper/src/cli.js --url "携程链接" --templateName "模板名"
```

## 正式运行

```bash
node scraper/src/cli.js --url "携程链接" --templateName "模板名"
```

正式运行不设置上述两个环境变量，因此不会创建 `logs/`，也不会写入 JSONL。

## 日志位置

开发模式日志写入：

```text
logs/perf/collect_perf_YYYY-MM-DD.jsonl
```

## 分析日志

```bash
python scripts/analyze_perf.py
```

也可以指定目录或文件：

```bash
python scripts/analyze_perf.py logs/perf
python scripts/analyze_perf.py logs/perf/collect_perf_2026-05-18.jsonl
```

## 报告输出对照

性能日志和结果报告是两套独立开关。`ENABLE_PERF_LOG=1` 只控制 `logs/perf/*.jsonl`；`--report-level` 控制采集结束后是否构建采集报告和输出 JSON。

轻量采集，不生成采集报告、调试输出：

```bash
HOTEL_COLLECTOR_ENV=dev ENABLE_PERF_LOG=1 node scraper/src/cli.js --url "携程链接" --templateName "模板名" --report-level off
```

默认报告路径对照：

```bash
HOTEL_COLLECTOR_ENV=dev ENABLE_PERF_LOG=1 node scraper/src/cli.js --url "携程链接" --templateName "模板名" --report-level normal
```

对比 `logs/perf/collect_perf_YYYY-MM-DD.jsonl` 时，重点看：

- `task_total`
- `scrapeMs`、`transitMs`
- `reportLevel=off` 时不应出现 `build_review_input`、`build_review_summary`、`build_report`、`write_report`
- `output/batch-items/` 不应产生新的大 JSON

## 打包排除

正式包使用 electron-builder。根包 `package.json` 和完整版采集器资源清单都会排除：

- `devtools/`
- `logs/`
- `tests/`
- `scripts/analyze_perf.py`
- `*.jsonl`
- `collect_perf.jsonl`
- `perf_log.py`

可运行以下命令检查打包资源合同：

```bash
node --test tests/package-scripts.test.js
```
