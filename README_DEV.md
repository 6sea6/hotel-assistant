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

## 采集性能日志

项目支持两种方式启用采集性能日志：

### 方式一：应用设置（推荐）

在应用设置页打开"采集性能日志"开关。开启后，采集任务会自动写入 JSONL 性能日志。

- 日志路径：`logs/perf/collect_perf_YYYY-MM-DD.jsonl`
- 默认关闭，普通使用建议关闭
- 用于排查慢任务和异常采集阶段

### 方式二：环境变量（开发用）

同时设置以下环境变量时，采集器也会写入日志：

- `HOTEL_COLLECTOR_ENV=dev`
- `ENABLE_PERF_LOG=1`

### 日志分析

```bash
python scripts/analyze_perf.py
python scripts/analyze_perf.py logs/perf
```

### 普通 output 报告 vs 性能日志

- **普通 output 报告**（`--report-level` 控制）：用于采集结果诊断，包含酒店数据、房型、价格等
- **性能日志**（设置开关或环境变量控制）：用于阶段耗时分析，包含各阶段 elapsed_ms、batch 统计等

两者独立互不影响。

## 统一自定义下拉组件 (custom-select)

项目使用 `src/renderer/modules/custom-select.js` 提供统一样式的下拉选择器，替代原生 `<select>` 的浏览器默认外观。

### 快速使用

普通单选 `<select>` 只需添加 `data-custom-select="true"`：

```html
<select id="mySelect" class="input" data-custom-select="true">
  <option value="">请选择</option>
  <option value="a">选项 A</option>
  <option value="b">选项 B</option>
</select>
```

应用初始化时已自动调用：

```js
setupCustomSelects(document, { auto: true });
```

`auto: true` 会自动增强所有 `select.input`（排除 `data-native-select="true"` 和 `data-custom-select="false"`）。

### 动态插入 DOM 后

运行时插入新的 `<select class="input">` 后，调用：

```js
import { refreshCustomSelects } from './modules/custom-select.js';
refreshCustomSelects(container, { auto: true });
```

它会自动发现并增强尚未增强的 `select.input`。

### 动态更新 options 后

当 `<select>` 的 `<option>` 在运行时被重建后，调用刷新以同步自定义菜单：

```js
import { refreshCustomSelect, refreshCustomSelects } from './modules/custom-select.js';

// 刷新单个
refreshCustomSelect(document.getElementById('mySelect'));

// 刷新所有已增强的
refreshCustomSelects();

// 刷新单个且自动增强（对新插入的 select.input 也生效）
refreshCustomSelect(document.getElementById('myNewSelect'), { auto: true });
```

### 单个新 select 手动增强

```js
import { enhanceCustomSelect } from './modules/custom-select.js';
enhanceCustomSelect(document.getElementById('mySelect'));
```

### 保留原生 select

需要保留浏览器原生外观时：

```html
<select class="input" data-native-select="true">...</select>
<!-- 或 -->
<select class="input" data-custom-select="false">...</select>
```

### 只排除自动增强，但允许手动 enhance

```html
<select class="input" data-custom-select-auto="false">...</select>
```

该 select 不会被 `setupCustomSelects(document, { auto: true })` 增强，但 `enhanceCustomSelect(select)` 仍可手动增强。

### 复用已有 DOM 的特殊组件

采集助手模板选择器等场景，需要复用页面上已有的 wrapper、button、menu：

```js
enhanceCustomSelect(select, {
  wrapperClass: 'ai-template-picker custom-select',
  buttonClass: 'input ai-template-picker-button custom-select-button',
  menuClass: 'ai-template-picker-menu custom-select-menu',
  optionClass: 'ai-template-picker-option custom-select-option',
  existingElements: {
    wrapper: document.getElementById('existingWrapper'),
    button: document.getElementById('existingButton'),
    menu: document.getElementById('existingMenu')
  }
});
```

### 公共 API

| 函数 | 说明 |
|------|------|
| `setupCustomSelects(root, options)` | 增强 root 内目标 select。`options.auto` 为 true 时增强所有 `select.input` |
| `enhanceCustomSelect(select, options)` | 增强单个 select，支持自定义 className 和复用已有 DOM |
| `refreshCustomSelect(select, options)` | 刷新单个 select 的菜单和按钮文本。`options.auto` 为 true 时对 `select.input` 自动 enhance |
| `refreshCustomSelects(root, options)` | 刷新范围内所有已增强 select。`options.auto` 为 true 时也增强新发现的 `select.input` |
| `destroyCustomSelect(select)` | 销毁增强，恢复原生 select |
| `closeAllCustomSelects()` | 关闭当前打开的菜单 |
| `getCustomSelectInstance(select)` | 获取 ctx 实例（调试用） |

### 开发规范

- 不要手写新的 picker 组件，优先使用 custom-select。
- 不要复制 ai-template-picker 逻辑，使用 `existingElements` 复用已有 DOM。
- 需要特殊样式时使用 variant/className，而不是复制一套逻辑。
- 原生 `<select>` 始终作为真实数据源，业务逻辑通过 `change` 事件触发。
- `MutationObserver` 会自动监听 `<select>` 子节点变化并同步菜单。
- 不要删除原生 select，custom-select 只是视觉增强层。
