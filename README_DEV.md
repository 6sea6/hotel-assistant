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
