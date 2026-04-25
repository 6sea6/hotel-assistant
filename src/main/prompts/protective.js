const {
  APP_CONFIG,
  HOTEL_EDITABLE_FIELDS,
  HOTEL_SYSTEM_FIELDS,
  TEMPLATE_FIELDS,
  TEMPLATE_INFO_FIELDS,
  getVersionTag,
  toFieldList,
  toFieldSchemaSummary
} = require('./shared');

function buildProtectivePrompt() {
  return `# 宾馆比较助手 AI 保护性提示词 ${getVersionTag()}

## 项目定位
这是一个基于 Electron 的本地桌面应用，用于录入、比较、筛选和排序宾馆数据。核心目标是让 AI 能稳定读取、补全、修改宾馆数据，同时不破坏现有功能与数据兼容性。

## 必守规则
1. 不要改坏数据存储机制。
   - 真实数据由 electron-store 管理。
   - 数据路径由 %APPDATA%/hotel-app-pointer.json 指向。
  - 打包安装版默认数据目录优先位于程序安装目录下的 宾馆比较助手 文件夹；如果用户已迁移，则以指针文件和程序当前显示路径为准。
   - 业务数据文件名为 hotel-data.json。
   - AI 提示词文件名为 ai-prompts.json。
2. 不要修改既有 IPC 频道名。
   - hotel:add/update/updateMultiple/delete/getAll/getById
   - template:add/update/updateAndSync/delete/getAll
   - settings:get/set/getAll
   - data:getPath/getFolderPath/changePath/showInFolder/export/import
   - ranking:exportImage
   - prompt:get/save
3. 不要破坏当前数据结构。
  - hotels 在界面与 IPC 层表现为平铺记录；磁盘上的 hotel-data.json 可能是分组压缩结构，单个元素形如 { shared, rooms }。
  - 如果必须直接处理磁盘文件，必须同时维护 shared 与 rooms 的对应关系，不要只改 shared.name 后沿用旧 rooms。
  - 采集结果回写比较助手时，优先使用采集器桥接命令，不要手工改 grouped 结构。
  - 宾馆可填写字段如下：
${toFieldSchemaSummary(HOTEL_EDITABLE_FIELDS)}
  - 宾馆系统字段如下：
${toFieldSchemaSummary(HOTEL_SYSTEM_FIELDS)}
  - templates 为数组，元素保留以下字段：
${toFieldSchemaSummary(TEMPLATE_FIELDS)}
  - template_info 为模板快照对象，字段如下：
${toFieldSchemaSummary(TEMPLATE_INFO_FIELDS)}
   - settings 保留权重、主题、语言、自动匹配、说明书展示等字段。
4. 不要让 AI 难以读写数据。
   - 优先保持 JSON 结构扁平、字段名稳定、含义明确。
   - 不要引入难以序列化的数据结构。
   - 不要把业务数据散落到多个新文件。
  - 不要遗漏已有字段，例如 address、website、subway_station、subway_distance、bus_route、original_room_type、room_area、notes、is_favorite。
5. 不要把同步风险留给用户。
   - 修改模板时必须同步关联宾馆。
   - 修改宾馆后要保证界面数据与持久层最终一致。
   - 删除、导入、迁移路径等操作必须有清晰反馈。
6. 不要伪造系统字段。
  - 新增宾馆时不要手动编造 id、created_at、updated_at。
  - template_info 只能来自现有模板匹配结果，不要凭空拼出一份模板快照。
7. 不要漏填用户已经提供的信息。
  - 如果用户给了网址，就填写 website。
  - 如果用户给了地址、最近地铁站名称、最近地铁站距离、公交路线、原始房型名、面积、设施、备注、收藏状态，也要同步写入对应字段。

## 重点功能清单
- 宾馆新增、编辑、删除、收藏
- 卡片视图与行式视图切换
- 模板应用与模板同步
- 日期联动与价格联动
- 多条件筛选与排名
- 数据导入、导出、迁移
- 排名图片导出
- AI 提示词管理
- 首次说明书与设置管理

## 编码约束
- 前端不要使用 alert 作为常规交互反馈，优先使用页面内通知。
- 修改表单交互时，确保打开弹窗后可立即输入，不要出现焦点丢失或遮罩穿透。
- 比较模板 ID、宾馆 ID 时，优先做类型兼容处理。
- 卡片视图中的 website 应显示在 address 右侧独立信息列，address 固定在左侧并保留可读宽度，website 从右侧信息列的固定起点开始显示，继续保持单行省略与原始链接跳转。
- 如果要做性能优化，优先从减少重复渲染、减少重复读取、降低主线程阻塞入手。
- 如果要做结构优化，优先抽离大段静态配置、默认文案、常量与重复逻辑。
- 卡片视图允许每个宾馆单独删除，并采用按钮二次确认。
- 行式视图的删除入口以右上角"删除选中"为主，不要依赖每行单独删除按钮。
- 批量删除优先走单次 IPC 或单次持久化提交，不要对每条记录逐个删除后再后台全量重载。

## 数据建议
推荐宾馆字段示例：
${toFieldList(HOTEL_EDITABLE_FIELDS)}

系统生成字段：
${toFieldList(HOTEL_SYSTEM_FIELDS)}

模板快照字段：
${toFieldList(TEMPLATE_INFO_FIELDS)}

## 开发者信息
- 作者：Sea
- 特别感谢：Asagirl、墨离、WorkBuddy、Trae、GitHub Copilot、Codex`;
}

module.exports = {
  buildProtectivePrompt
};
