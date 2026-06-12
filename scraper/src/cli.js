const { setup_perf_logger, PerfTimer } = require('./runtime/perf');

const CLI_STARTED_AT_MS = Date.now();
const CLI_TASK_KIND = process.argv.includes('--apply-output') ? 'apply_output' : 'collect';
const cliPerfLogger = setup_perf_logger();
const cliPerf = new PerfTimer(cliPerfLogger, {
  runId: `cli-${CLI_STARTED_AT_MS}`,
  taskId: `cli-${process.pid}`,
  taskKind: CLI_TASK_KIND,
  mode: CLI_TASK_KIND
});
cliPerf.event('script_start', {
  phase: 'script_start',
  status: 'success',
  elapsed_ms: 0,
  taskKind: CLI_TASK_KIND
});

const importPhase = cliPerf.phase('import_modules');
const path = require('path');
const { DEFAULT_LATEST_RUN_PATH } = require('./cli/run-summary');
const { runHotelImportTask, writeFailureSummary } = require('./task-runner');
const { compactCliResult, parseArgs } = require('./utils');
importPhase.end('success', {
  elapsed_ms: Date.now() - CLI_STARTED_AT_MS
});

const CLI_ARGS = parseArgs(process.argv);
const RUN_STARTED_AT = new Date().toISOString();

function printHelp() {
  console.log(`
用法:
  node src/cli.js --template ./examples/template.sample.json
  node src/cli.js --url <携程链接> --templateName <模板名>
  node src/cli.js --urls "<多个携程链接或混合文本>" --templateName <模板名>
  node src/cli.js --url <携程链接> --checkIn <YYYY-MM-DD> --checkOut <YYYY-MM-DD> --roomCount <人数> [--destination <目的地>]
  node src/cli.js --apply-output output/<酒店名>.json

可选参数:
  --url <携程链接>          推荐写法，直接传入携程酒店详情页或列表页链接
  --urls <文本/链接列表>    从多 URL 或混合粘贴文本中提取多个携程酒店链接
  --ctrip_url <携程链接>   兼容旧调用写法，等价于 --url
  --ctrip-url <携程链接>   兼容 kebab-case 写法，等价于 --url
  --targetCount <数量>     列表页目标采集酒店数量，默认 10
  --out <路径>              指定输出 JSON 文件路径
  --latestRun <路径>        指定最终运行凭证 JSON 路径，默认 output/latest-run.json
  --report-level <级别>     输出报告级别：off/summary/normal/full，默认 normal
  --skip-report             等价于 --report-level off，不生成采集报告和复核输入
  --no-output-report        等价于 --report-level off，不生成采集报告和复核输入
  --capture-strategy <策略>  采集策略：auto/html_first/parallel_edge/edge_full，默认 auto
  --html <路径>             使用本地保存的携程 HTML 文件而不是直接联网抓取
  --apply-output <路径>     复核通过后，将输出 JSON 安全回写到比较助手（通过桥接层处理 grouped/shared+rooms 结构）
  --save-html              联网抓取时额外保存原始 HTML 快照
  --write-app-data         危险：跳过最终人工复核，直接写入比较助手
  --unsafe-allow-unreviewed-write  与 --write-app-data 配合使用，显式确认接受未复核写入风险
  --templateId <ID>        关联宾馆比较助手中已有模板
  --templateName <名称>    按模板名称精确匹配宾馆比较助手中的模板，不再默认 bw
  --amapKey <KEY>          覆盖默认高德 Key
  --edge-user-data-dir <路径>      复用现有 Edge/360 用户数据目录，例如 C:/Users/你/AppData/Local/Microsoft/Edge/User Data
  --edge-profile-directory <名称>  指定 Edge/360 Profile 目录名，例如 Default 或 Profile 1
  --edge-debugger-url <地址>       直接附着到已开启远程调试的 Edge/360 WebSocket 地址
  --edge-debugging-port <端口>     直接附着到已开启远程调试的 Edge/360 端口，例如 9222
  --edge-headless <true|false>     启动复用 profile 的 Edge/360 时是否使用 headless，默认 true
  --browser <edge|360>      采集浏览器选择，默认 edge；edge 缺失时会尝试 360
  --auto-edge               自动在后台隐藏启动 Edge/360，会话采集完成后自动关闭
  --help                   显示帮助
`);
}

async function main() {
  if (CLI_ARGS.help) {
    printHelp();
    return;
  }

  const result = await runHotelImportTask(CLI_ARGS, {
    startedAt: RUN_STARTED_AT,
    perfLogger: cliPerfLogger,
    runId: cliPerf.meta && cliPerf.meta.run_id,
    scriptStartLogged: true
  });
  console.log(JSON.stringify(compactCliResult(result)));
}

main().catch((error) => {
  const latestRunPath = path.resolve(CLI_ARGS.latestRun || DEFAULT_LATEST_RUN_PATH);
  const result = writeFailureSummary(error, latestRunPath, RUN_STARTED_AT);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
});
