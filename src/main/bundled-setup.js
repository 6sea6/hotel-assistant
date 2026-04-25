const fs = require('fs');
const path = require('path');
const os = require('os');
const { getPaths } = require('./config');
const { DataFolderManager } = require('./utils');
const { migratePrompts } = require('./prompt-migration');
const { requireSharedCompareAppModule } = require('./shared-compare-app');
const {
  BUNDLE_RESOURCE_MAP,
  PROMPT_CONTRACT,
  getBundledSkillTargetDir
} = requireSharedCompareAppModule('prompt-contract.js');
const {
  getBundledResourcePaths,
  isBundledScraperAvailable
} = requireSharedCompareAppModule('runtime-paths.js');

function resolveBundledPaths(appDataPath = getBundledAppDataPath()) {
  return getBundledResourcePaths({
    resourcesPath: process.resourcesPath || '',
    appDataPath,
    promptsFileName: getPaths().PROMPTS_FILE,
    unifiedPromptFileName: PROMPT_CONTRACT.unifiedPromptFileName,
    bundleResourceMap: BUNDLE_RESOURCE_MAP,
    homeDir: os.homedir()
  });
}

function getScraperPath() {
  return resolveBundledPaths().scraperPath;
}

function getSkillSourcePath() {
  return resolveBundledPaths().skillSourcePath;
}

function getBundledAppDataPath() {
  const dataFolderManager = new DataFolderManager();
  const dataFolder = dataFolderManager.getDataFolderPath();
  dataFolderManager.ensureDataFolder(dataFolder);
  return dataFolder;
}

function getBundledWorkDir() {
  return resolveBundledPaths().bundledWorkDir;
}

function getBundledPromptSeedPath() {
  return resolveBundledPaths().promptSeedPath;
}

function getBundledPromptTargetPath() {
  return resolveBundledPaths().promptTargetPath;
}

function getBundledUnifiedPromptSourcePath() {
  return resolveBundledPaths().unifiedPromptSourcePath;
}

function getBundledUnifiedPromptTargetPath() {
  return resolveBundledPaths().unifiedPromptTargetPath;
}

function isBundledWithScraper() {
  return isBundledScraperAvailable(resolveBundledPaths());
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function seedBundledCompareAppPrompts() {
  if (!isBundledWithScraper()) {
    return false;
  }

  const promptSeedPath = getBundledPromptSeedPath();
  if (!fs.existsSync(promptSeedPath)) {
    return false;
  }

  const promptTargetPath = getBundledPromptTargetPath();
  if (!fs.existsSync(promptTargetPath)) {
    copyFileSync(promptSeedPath, promptTargetPath);
  }

  try {
    const prompts = JSON.parse(fs.readFileSync(promptTargetPath, 'utf-8'));
    const migration = migratePrompts(prompts);
    if (migration.changed) {
      fs.writeFileSync(promptTargetPath, JSON.stringify(migration.prompts, null, 2));
    }
  } catch (error) {
    console.error('[bundled-setup] 迁移 AI 提示词失败:', error);
  }

  return fs.existsSync(promptTargetPath);
}

function deployBundledUnifiedPrompt() {
  if (!isBundledWithScraper()) {
    return '';
  }

  const promptSourcePath = getBundledUnifiedPromptSourcePath();
  if (!fs.existsSync(promptSourcePath)) {
    return '';
  }

  const promptTargetPath = getBundledUnifiedPromptTargetPath();
  copyFileSync(promptSourcePath, promptTargetPath);
  return promptTargetPath;
}

function ensureBundledBootstrapResources() {
  if (!isBundledWithScraper()) {
    return;
  }

  seedBundledCompareAppPrompts();
  ensureBundledRuntimeDirs();
  deployBundledUnifiedPrompt();
}

/**
 * 重写 SKILL.md 和 field-rules.md 中的硬编码路径，使其指向安装后的实际位置。
 * 分两层替换：源码引用 → 只读安装目录，运行时引用 → 可写工作目录。
 * 对 SKILL.md 额外修正执行命令（node → Electron exe + ELECTRON_RUN_AS_NODE）。
 */
function rewriteSkillPaths(skillTargetDir, scraperPath, appDataPath, bundledPromptGuidePath) {
  const workDir = path.join(appDataPath, BUNDLE_RESOURCE_MAP.runtimeWorkDirName);
  const nodeExePath = process.execPath;
  const filesToRewrite = ['SKILL.md', path.join('references', 'field-rules.md')];
  const promptGuidePath = bundledPromptGuidePath || getBundledUnifiedPromptTargetPath();
  const scraperReadmePath = path.join(scraperPath, 'README.md');
  const resourceAppAsarPath = path.join(process.resourcesPath, 'app.asar');
  const tokenMap = {
    compareAppData: '__HOTEL_COMPARE_APP_DATA__',
    compareAppSource: '__HOTEL_COMPARE_APP_SOURCE__',
    scraperReadme: '__HOTEL_SCRAPER_README__',
    scraperWorkDir: '__HOTEL_SCRAPER_WORK_DIR__'
  };

  for (const relPath of filesToRewrite) {
    const fullPath = path.join(skillTargetDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    let content = fs.readFileSync(fullPath, 'utf-8');

    // === 基础路径替换（所有文件通用） ===
    // 先替换成占位符，避免新路径里再次命中旧路径规则而被二次改写。
    content = content.replace(/E:[\\\/]+实验[\\\/]+1[\\\/]+宾馆比较助手/g, tokenMap.compareAppData);
    content = content.replace(/E:[\\\/]+实验[\\\/]+1/g, tokenMap.compareAppSource);
    content = content.replace(/E:[\\\/]+实验[\\\/]+2[\\\/]+README\.md/g, tokenMap.scraperReadme);
    content = content.replace(/E:[\\\/]+实验[\\\/]+2/g, tokenMap.scraperWorkDir);
    content = content.replace(new RegExp(tokenMap.compareAppData, 'g'), () => appDataPath);
    content = content.replace(new RegExp(tokenMap.compareAppSource, 'g'), () => path.join(process.resourcesPath, 'app.asar'));
    content = content.replace(new RegExp(tokenMap.scraperReadme, 'g'), () => scraperReadmePath);
    content = content.replace(new RegExp(tokenMap.scraperWorkDir, 'g'), () => workDir);
    content = content.replace(
      new RegExp(`${escapeRegExp(resourceAppAsarPath)}[^\r\n]*?AppData\\Roaming\\宾馆比较助手`, 'g'),
      () => appDataPath
    );
    content = content.replace(/工作区根目录的\s*`?00-后续AI统一提示词\.md`?/g, () => `可写工作目录中的 \`${promptGuidePath}\``);
    content = content.replace(/`README\.md`/g, () => `\`${scraperReadmePath}\``);
    content = content.replace(/`00-后续AI统一提示词\.md`/g, () => `\`${promptGuidePath}\``);

    // === SKILL.md 专用：修正执行命令以适配打包环境（无全局 node） ===
    if (relPath === 'SKILL.md') {
      // (1) _run.js 代码块中 spawn('node', ...) → spawn(process.execPath, ..., ELECTRON_RUN_AS_NODE)
      content = content.replace(
        /spawn\('node',\s*args,\s*\{\s*stdio:\s*'inherit',\s*cwd:\s*__dirname\s*\}\)/g,
        `spawn(process.execPath, args, { stdio: 'inherit', cwd: __dirname, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })`
      );

      // (2) _run.js 代码块中 'src/cli.js' → 采集器源码的绝对路径（JS 字符串需转义反斜杠）
      const cliAbsForJs = path.join(scraperPath, 'src', 'cli.js').replace(/\\/g, '\\\\');
      content = content.replace(
        /'src\/cli\.js'/g,
        `'${cliAbsForJs}'`
      );

      // (3) PowerShell 命令: node _run.js → 设置环境变量 + Electron exe
      content = content.replace(
        /node _run\.js/g,
        `$env:ELECTRON_RUN_AS_NODE = "1"; & "${nodeExePath}" _run.js`
      );

      // (4) PowerShell 命令: node src/edge-session.js → Electron exe + 绝对路径
      content = content.replace(
        /node src\/edge-session\.js/g,
        `$env:ELECTRON_RUN_AS_NODE = "1"; & "${nodeExePath}" "${path.join(scraperPath, 'src', 'edge-session.js')}"`
      );

      // (5) 在执行流程前插入打包环境提示，让 AI 意识到环境差异
      content = content.replace(
        '## 执行流程',
        `> **打包版环境提示**：本 Skill 由安装包自动部署，所有命令已适配打包环境。使用 Electron 内置 Node（须设 \`ELECTRON_RUN_AS_NODE=1\`），可写工作目录为 \`${workDir}\`，采集器源码（只读）在 \`${scraperPath}\`。文末有完整路径表。\n\n## 执行流程`
      );
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

/**
 * 在 SKILL.md 末尾追加打包版专用操作说明，让 AI 知道如何在安装后的环境下操作。
 */
function appendBundledInstructions(skillTargetDir, scraperPath, appDataPath, bundledPromptGuidePath) {
  const skillMdPath = path.join(skillTargetDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return;

  let content = fs.readFileSync(skillMdPath, 'utf-8');
  const marker = '## 打包版专用说明';
  if (content.includes(marker)) return; // 已追加过

  const nodeExePath = process.execPath; // Electron 内嵌的 node
  const scraperSrcPath = path.join(scraperPath, 'src'); // 采集器源码目录（只读）
  const workDir = path.join(appDataPath, BUNDLE_RESOURCE_MAP.runtimeWorkDirName); // 可写工作目录
  const promptGuidePath = bundledPromptGuidePath || getBundledUnifiedPromptTargetPath();
  const promptTargetPath = getBundledPromptTargetPath();
  const instructions = `

${marker}

> 以下内容仅适用于通过安装包部署的环境。安装包已将采集器和本 Skill 一起打包，用户无需单独安装 Node.js 或手动复制文件。

### 环境信息

| 项目 | 路径 | 说明 |
|------|------|------|
| 采集器源码目录（只读） | \`${scraperPath}\` | cli.js 等源码在此，不要在此目录写文件 |
| 可写工作目录 | \`${workDir}\` | _run.js、output、state 等运行时文件在此 |
| 统一提示词文件 | \`${promptGuidePath}\` | 安装包内置的唯一权威采集规则文件 |
| 比较助手数据目录 | \`${appDataPath}\` | hotel-data.json 等数据 |
| 运行期 AI 提示词文件 | \`${promptTargetPath}\` | 首次启动会自动从安装包种入，后续保留本地修改 |
| Node.js 可执行文件 | \`${nodeExePath}\` | Electron 自带的 Node |
| Edge 登录态目录 | \`${path.join(workDir, 'state', 'edge-profile')}\` | 用户登录携程后保存于此 |
| 采集输出目录 | \`${path.join(workDir, 'output')}\` | latest-run.json 等采集结果 |

### 重要：工作目录说明

采集器源码位于安装目录（只读），所有运行时数据（Edge 登录态、采集输出、临时脚本）都存放在可写工作目录 \`${workDir}\`。

执行采集脚本时，**必须将 cwd 设为可写工作目录**，将 cli.js 以绝对路径传入。cli.js 的 \`require()\` 按自身位置解析模块（不受 cwd 影响），而 \`path.resolve('output')\` 等相对路径按 cwd 解析（写到可写目录）。

### 采集命令调整

打包环境中没有全局 Node.js，需要使用安装包自带的 Electron Node 来执行采集脚本。

**关键**：必须设置环境变量 \`ELECTRON_RUN_AS_NODE=1\`，否则 Electron exe 会启动应用窗口而不是执行脚本。

\`\`\`javascript
// _run.js 示例（写入可写工作目录后执行）
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const runScriptPath = __filename;
const url = '这里放完整携程链接';
const cliPath = path.join('${scraperSrcPath.replace(/\\/g, '\\\\')}', 'cli.js');
const args = [
  cliPath,
  '--url', url,
  '--templateName', '模板名',
  '--auto-edge',
  '--edge-user-data-dir', './state/edge-profile',
  '--edge-profile-directory', 'Default',
  '--edge-debugging-port', '9222',
  '--edge-headless', 'false'
];
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  cwd: __dirname,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
const cleanupRunScript = () => {
  try {
    fs.unlinkSync(runScriptPath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error('清理临时脚本失败:', error.message);
    }
  }
};
child.once('error', (error) => {
  console.error('采集启动失败:', error);
  cleanupRunScript();
  process.exit(1);
});
child.once('exit', code => {
  cleanupRunScript();
  process.exit(typeof code === 'number' ? code : 1);
});
\`\`\`

执行命令（PowerShell）：
\`\`\`powershell
Set-Location -Path "${workDir}"
$env:ELECTRON_RUN_AS_NODE = "1"
& "${nodeExePath}" _run.js
\`\`\`

如果必须把上述 PowerShell 命令压成一行，统一使用分号 \`;\`，不要使用 \`&&\`，以兼容 Windows PowerShell 5.x。

清理临时脚本或临时目录时，统一在 Node.js 进程内使用 \`fs.unlinkSync()\` 或 \`fs.rmSync({ recursive: true, force: true })\`；不要再在 PowerShell 或 cmd 层用 \`Remove-Item\`、\`del\`。

### Edge 登录命令调整

\`\`\`powershell
Set-Location -Path "${workDir}"
$env:ELECTRON_RUN_AS_NODE = "1"
& "${nodeExePath}" "${path.join(scraperSrcPath, 'edge-session.js')}" --login --userDataDir ./state/edge-profile --profileDirectory Default --port 9222 --url "桌面版链接"
\`\`\`

### 读取采集结果

采集完成后照常读取：
- 最新运行结果：\`${path.join(workDir, 'output', 'latest-run.json')}\`
- 酒店详情：\`${path.join(workDir, 'output', '<酒店名>.json')}\`

### 写入比较助手

当前安装版默认会把数据目录放在安装目录下的 宾馆比较助手 文件夹；如果用户后来在程序里迁移过，再通过 \`%APPDATA%/hotel-app-pointer.json\` 指针定位。当前环境通常在：
\`${appDataPath}\`
`;

  content += instructions;
  fs.writeFileSync(skillMdPath, content, 'utf-8');
}

function ensureBundledRuntimeDirs() {
  if (!isBundledWithScraper()) return;

  const workDir = getBundledWorkDir();
  const runtimeDirs = [
    path.join(workDir, 'state', 'edge-profile'),
    path.join(workDir, 'output'),
    path.join(workDir, 'output', 'raw-pages')
  ];

  for (const dir of runtimeDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function scheduleBundledSetup(delayMs = 0) {
  const timer = setTimeout(() => {
    try {
      setupBundledModules();
    } catch (error) {
      console.error('[bundled-setup] 初始化失败:', error);
    }
  }, Math.max(0, Number(delayMs) || 0));

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
}

/**
 * 首次启动时自动部署捆绑的 AI 数据采集模块：
 * 1. 部署 skill 文件到 ~/.workbuddy/skills/hotel-data-filler/
 * 2. 重写 skill 中的硬编码路径
 * 3. 追加打包版专用操作指南
 * 4. 确保 edge-profile 和 output 目录存在
 */
function setupBundledModules() {
  if (!isBundledWithScraper()) return;

  seedBundledCompareAppPrompts();
  const scraperPath = getScraperPath();
  const appDataPath = getBundledAppDataPath();
  const bundledPromptGuidePath = deployBundledUnifiedPrompt();

  // 1. 部署 skill 文件
  const skillSource = getSkillSourcePath();
  const skillTarget = getBundledSkillTargetDir(os.homedir());
  if (fs.existsSync(skillSource) && fs.existsSync(path.join(skillSource, 'SKILL.md'))) {
    copyDirSync(skillSource, skillTarget);
    rewriteSkillPaths(skillTarget, scraperPath, appDataPath, bundledPromptGuidePath);
    appendBundledInstructions(skillTarget, scraperPath, appDataPath, bundledPromptGuidePath);
    console.log('[bundled-setup] Skill 已部署到', skillTarget);
  }

  // 2. 确保可写工作目录存在（默认位于当前数据目录下）
  ensureBundledRuntimeDirs();

  console.log('[bundled-setup] AI 数据采集模块初始化完成');
}

module.exports = {
  ensureBundledBootstrapResources,
  isBundledWithScraper,
  getScraperPath,
  ensureBundledRuntimeDirs,
  scheduleBundledSetup,
  setupBundledModules
};
