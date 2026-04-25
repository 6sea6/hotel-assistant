# 宾馆比较助手 v6.6

## 项目概述

这是一个基于 Electron 的本地宾馆比较助手，用于录入、筛选、排序和导出宾馆数据，并支持模板复用、模板时间范围展示、个性化主题与应用图标切换、AI 提示词管理和中文化调试。

## 代码结构优化

### 优化前的问题

- `main.js` 文件过长（约700行），包含过多职责
- 所有代码集中在单个文件中，难以维护
- 常量和配置硬编码在代码中
- IPC 处理程序混在一起
- 缺乏模块化设计

### 优化后的结构

```
src/main/
├── main.js                 # 应用入口点
├── config.js              # 应用配置和常量
├── utils.js               # 工具函数和类
├── store-manager.js       # 数据存储管理
├── window-manager.js      # 窗口管理
├── menu-manager.js        # 菜单管理
├── ipc-handler-manager.js # IPC 处理程序管理
└── ipc-handlers/          # IPC 处理程序目录
    ├── hotel-handlers.js      # 酒店相关处理
    ├── template-handlers.js   # 模板相关处理
    ├── settings-handlers.js   # 设置相关处理
    ├── data-handlers.js       # 数据导入导出处理
    ├── prompt-handlers.js     # AI提示词处理
    └── other-handlers.js      # 其他处理（外部链接等）
```

### 当前重点能力

1. 模块化主进程结构，便于维护和扩展
2. 卡片视图单项删除与行式视图批量删除分离
3. 行式批量删除后弹窗输入焦点加固
4. F12 打开的开发者工具优先切换中文
5. AI 提示词统一由主进程默认源提供
6. 打包脚本优先复用现有依赖并清理无用验证产物
7. 模板管理列表可直接查看入住与离店日期
8. 顶部“个性化”面板支持切换十套主题，并可更换窗口图标后恢复默认
9. 宾馆列表头部提供手动刷新按钮，可重新拉取当前窗口内的宾馆、模板和设置数据
10. 数据导入优先兼容本应用旧版本导出的 JSON，并在失败时自动回滚到导入前状态
11. 自定义窗口图标会复制到当前数据目录内，删除原始图片不影响使用，并会随 JSON 备份一起导出与恢复
12. 完整版安装包首次启动会自动将运行期 AI 提示词种入数据目录，基础版不再携带这类采集执行文件
13. 完整版安装包会内置工作区中的采集 Skill 与统一提示词，并在首次启动时部署到安装环境，避免依赖构建机用户目录

### 技术栈

- **Electron**: 跨平台桌面应用框架
- **electron-store**: 本地数据存储
- **Node.js**: 服务端运行时

### 运行方式

```bash
npm install
npm start
```

### 构建方式

```bash
npm run build
```

### 打包说明

- Windows 安装包脚本: build-nsis.bat
- 默认输出目录: dist
- 默认打包图标源文件: `assets/app-icon.png`（或同名 jpg/jpeg/bmp/webp），构建时会统一生成 `build/icon.ico`、`build/uninstallerIcon.ico` 和安装页侧栏图
- 基础版安装包只包含比较助手本体，不再携带采集器、统一提示词、Skill、`ai-prompts.json` 等采集执行文件
- 完整版安装包除了比较助手本体，还会打入实验2中的采集器源码、README、统一提示词 `00-后续AI统一提示词.md`、工作区 Skill `2/.workbuddy/skills/hotel-data-filler/SKILL.md`，以及运行期 `ai-prompts.json` 种子
- 完整版首次启动会把采集统一提示词部署到当前数据目录下的 `scraper-data`，并把 Skill 部署到当前用户目录下的 `.workbuddy/skills/hotel-data-filler`
- 调试验证产物建议在验证后删除，避免工作区和磁盘体积继续增长

### 数据导入约定

- 导入来源约定为本应用自己导出的 JSON 备份文件
- 导出文件会带上 appVersion、schemaVersion 和 meta，方便后续 AI 判断来源版本
- 导入时可选择“覆盖导入”或“追加导入”：覆盖会替换当前宾馆、模板和设置；追加只新增宾馆和模板，保留当前设置与窗口图标
- 追加导入时会自动为冲突或缺失的宾馆/模板 ID 重新分配新 ID，并同步修正宾馆里的模板引用，避免导入后模板关联串号
- 导入时会统一归一化宾馆和模板中的 ID 类型，并补齐缺失设置默认值
- 如果导入过程中任一步失败，程序会恢复导入前的 hotels、templates、settings，避免出现半写入状态
- 当前自定义窗口图标会以 base64 形式写入导出 JSON 的 meta.customAppIcon，导入时恢复到当前数据目录内的受管图标文件
