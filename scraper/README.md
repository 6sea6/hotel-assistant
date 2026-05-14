# 携程宾馆采集与比较助手导入工具

## 后续 AI 入口

后续 AI 接手本工作区时，先阅读根目录的 `00-后续AI统一提示词.md`。本 README 只负责运行方式、技术说明和排查手册，不再单独维护一套业务填写规则。

工作目录：`E:\实验\1\scraper`。采集器已内置在 Electron 宾馆比较助手项目中，默认通过应用内任务入口或本目录 CLI 读取比较助手规则和数据。

当前测试/开发环境默认直接使用项目内置 `scraper` 目录作为采集器工作目录，不要先探测 `E:\实验\hotel-comparison-app\...` 这类打包路径。只有当打包版采集规则说明文件与 exe/采集器资源真实存在时，才切换到安装包环境的执行说明。

## 能力范围

- 读取携程酒店详情链接，自动提取酒店名、地址、携程评分、候选房型
- 输出**所有**符合条件的房型（有价格、人数达标），而非仅最优
- 调用高德开放平台计算酒店到目的地的公共交通距离、时间、最近地铁站距离和推荐换乘路线；若模板中的 destination 为空，则只查询酒店附近地铁站，不计算到目的地的距离与路线
- 生成与宾馆比较助手兼容的酒店记录，默认走“采集 -> 复核 -> 写入”流程

程序不再默认套用 `bw`，也不再按日期、人数、目的地自动猜模板。现在只会按你显式给出的 `templateId` 或 `templateName` 精确匹配现有模板；如果没有给模板，就必须自己提供 `checkIn`、`checkOut`、`roomCount`，需要算交通时再额外提供 `destination`。若最终模板 destination 为空，程序不会报错，而是只查询酒店附近地铁站。

模板数据源优先级如下：

1. 环境变量 `HOTEL_COMPARE_APP_DATA_DIR`
2. 本地开发模式下同级工作区 `E:\实验\1\宾馆比较助手`
3. `%APPDATA%/hotel-app-pointer.json` 指向的数据目录
4. 安装版程序目录下的 `宾馆比较助手`
5. `%APPDATA%/宾馆比较助手`

如果你希望强制采集器读取某个特定数据目录，先设置：

```powershell
$env:HOTEL_COMPARE_APP_DATA_DIR = "E:\实验\1\宾馆比较助手"
```

## 安装

需要 Node.js 18+。依赖已在 `package-lock.json` 中锁定，首次执行：

```bash
npm install
```

现在不再依赖 Playwright，也不需要额外下载浏览器。

## ⭐ 运行方式（推荐）

**用 Node.js 直接运行，不要用 PowerShell 直接调用（PowerShell 会误解析 URL 中的 `&` 符号）。如果必须在 PowerShell 里把多条命令写成一行，统一用分号 `;`，不要用 `&&`，以兼容 Windows PowerShell 5.x。**

### AI 采集一条龙（启动 Edge → 采集 → 自动关闭）

**推荐方式**：使用 `--auto-edge` 参数，一条命令完成后台启动 Edge、采集、自动关闭：

```bash
node src/cli.js --url "携程链接" --templateName 模板名 --auto-edge --edge-user-data-dir ./state/edge-profile --edge-profile-directory Default --edge-debugging-port 9222
```

`--auto-edge` 会自动在后台隐藏启动 Edge、等待调试端口就绪、执行采集、采集完成后关闭 Edge，不再把网页弹到前台影响当前电脑使用。首次使用如果还没有可复用的 Edge profile，会先自动打开一次可见 Edge 窗口让你登录携程；登录完成后关闭窗口，当前任务再继续后台采集。默认优先用 hidden/headless 会话；只有排障或主动重登时，才需要单独运行可见的 `edge-session.js --login`。如果某家酒店疑似必须在登录态的可见窗口里手动打开后，目标房型价格才会真正显示出来，不要只在后台盲重试；改为先用可见窗口重试一次并确认目标房型价格已在页面上显示，再继续采集。

也可以在首次登录或登录态失效时分两步手动执行：

```bash
# 1. 启动可见 Edge 调试会话，手工登录并保存登录态
node src/edge-session.js --login --userDataDir ./state/edge-profile --profileDirectory Default --port 9222 --url "携程链接"

# 2. 执行采集（自动用 Edge 登录态获取真实价格）
node src/cli.js --url "携程链接" --templateName 模板名 --edge-user-data-dir ./state/edge-profile --edge-profile-directory Default --edge-debugging-port 9222
```

也可以用 bat 一键完成（bat 内部调用的就是上面的 Node.js 命令）：

```bat
一键启动Edge并采集.bat "携程链接" 模板名
```

这里的模板名改为显式必填；如果你不想用模板，请改用 `node src/cli.js` 直接传 `--checkIn`、`--checkOut`、`--roomCount` 等参数。

> **Edge 登录态说明**：携程对大量酒店隐藏价格（显示"登录看低价"），不带登录态拿不到价格。Edge 登录态通过 `state/edge-profile/` 持久保存。现在首次运行 `--auto-edge` 时，如果检测到这是一个全新的 profile，会自动先弹出一次可见 Edge 登录准备窗口；登录完成后关闭窗口即可，后续 `--auto-edge` 会在后台自动复用该登录态并在每次采集结束后关闭会话。

如果怀疑目标房型价格只有在可见窗口里手动打开酒店详情页后才会解锁，可直接把采集命令改成：

```bash
node src/cli.js --url "携程链接" --templateName 模板名 --auto-edge --edge-user-data-dir ./state/edge-profile --edge-profile-directory Default --edge-debugging-port 9222 --edge-headless false
```

先肉眼确认目标房型价格已经在页面上显示，再关闭窗口并重新执行正常采集；不要只在后台重复跑同一条隐藏会话命令。

如果打包版流程为了执行命令临时写入了 `_run.js` 等脚本，清理时统一在 Node.js 进程内使用 `fs.unlinkSync()` 或 `fs.rmSync({ recursive: true, force: true })`；不要在 PowerShell 或 cmd 层再用 `Remove-Item`、`del`。

## 弱模型最小流程

如果执行任务的 AI 只能可靠地遵守固定步骤，就只按下面流程操作：

1. 如果用户已经明确给出模板名，优先直接运行 CLI；只有模板名不确定时，才读取 `E:\实验\1\宾馆比较助手\hotel-data.json` 的 `templates` 数组确认模板。
2. 只运行上面的推荐命令，不自行组合其他采集路径；如果在 PowerShell 里写成单行，命令之间用 `;`，不要用 `&&`。
3. 采集后只读取 `output/latest-run.json` 判断是否成功，不看终端回显。
如果打包版流程临时写了 `_run.js` 等脚本，清理时统一在 Node.js 进程内用 `fs.unlinkSync()` 或 `fs.rmSync({ recursive: true, force: true })`；不要在 PowerShell 或 cmd 层用 `Remove-Item`、`del`。
4. `success=false`、`eligibleCount=0` 或 `totalPrice=null` 时，停止写入，先汇报结果。
5. 只有 `success=true`、`eligibleCount>0`、`totalPrice!=null` 时，先用 `eligibleRoomTypes` 和 `eligibleHotels` 做快速复核；只有排障或怀疑房型解析异常时，才继续读取 `output/<酒店名>.json`。
6. 复核通过后，不要手工直接改 `hotel-data.json` 的磁盘分组结构；改为执行桥接回写命令：`node src/cli.js --apply-output "output/<酒店名>.json"`。
7. 正常流程不要使用 `--write-app-data`；它会跳过最终人工复核。

### 采集后写入比较助手

采集程序不会自动写入比较助手（因为需要 AI 过滤无窗/超出人数等房型）。采集完成后，AI 需要：

1. 读取 `output/latest-run.json` 确认采集结果
2. 优先用 `eligibleRoomTypes` 和 `eligibleHotels` 做快速复核；只有要深排查时再读 `output/<酒店名>.json`
3. **过滤掉不合规房型**（见下方"房型过滤规则"）
4. 复核通过后，执行 `node src/cli.js --apply-output "output/<酒店名>.json"`，通过桥接层安全写入比较助手
5. 不要手动编造 `id`、`created_at`、`updated_at`
6. 正常流程不要使用 `--write-app-data`
7. 回写时只更新当前输出里与已有记录重复的房型，并追加新的房型；历史房型如果这次没有出现在输出里，也不要自动删除，除非用户明确要求清理旧数据

### 用模板文件运行

把 URL 和参数写入 JSON 模板文件，再用 `--template` 参数运行：

```bash
node src/cli.js --template examples/template.实验.json --auto-edge --edge-user-data-dir ./state/edge-profile --edge-profile-directory Default --edge-debugging-port 9222
```

模板格式见 `examples/` 目录。URL 中的日期会被模板日期自动覆盖，不需要手动改。

### 完整 Node.js 参数

```bash
node src/cli.js --url "携程链接" --templateName bw \
  --edge-user-data-dir ./state/edge-profile \
  --edge-profile-directory Default \
  --edge-debugging-port 9222 \
  --auto-edge               # 可选：后台隐藏启动 Edge，采集完成后自动关闭
  --write-app-data           # 危险：跳过最终人工复核，直接写入比较助手
  --unsafe-allow-unreviewed-write  # 只有明确接受风险时才与 --write-app-data 配合使用
```

## 房型过滤规则（写入比较助手前必须执行）

采集程序的 eligible rooms 只做基础筛选。写入比较助手前，AI 必须额外过滤：

1. **排除无窗/部分有窗/走廊窗房型** — 携程标注"无窗"、"部分有窗"、"窗户位于走廊"或"窗户位于过道"的房型直接排除
2. **人数默认精确匹配模板** — 默认只保留 `occupancy == 模板 room_count` 的房型；如果比较助手设置里开启“3人模板时额外保留4人房”，则在 `room_count = 3` 时也允许保留 `occupancy = 4` 的房型，其他超员房型仍排除；此时写回比较助手的酒店记录 `room_count` 应按房型实际可住人数写成 `4`
3. **排除仅支持更高人数的房型** — 如模板要求 2 人，标注"3人入住"且不支持 2 人的房型排除
4. **整家酒店全部明确不可免费取消时整家跳过** — 只有当所有候选房型都明确写了不可取消、不支持取消、确认后不可退改，或仅支持订单确认后 xx 分钟/xx 天内免费取消时，才不写入比较助手；入住前一天免费取消和未明确写不能取消的，都按可取消处理
5. **不要只凭房型名猜床型** — `套房`、`豪华房`、`高级房` 等原始名称不等于实际床型；`套房` 必须继续按床型落到大床房、双床房、家庭房或三床房，如标准化结果看起来反常，先检查 `output/<酒店名>.json` 里 `scrape_debug.eligible_rooms[].text` 解析出的 `physicalRoom.bedInfo`
6. **校验 room_type 时先信任结构化床型信息** — 采集器已给出 `room_type` 时，优先以结构化数据复核，不要因为标题听起来像双床/大床就随意改写
7. **不手动改系统字段** — `id`、`created_at`、`updated_at` 由程序自动生成，不要手动编造或覆盖

## 输出内容

结果写入 `output/` 目录：

- `output/<酒店名>.json` — 完整输出（含 hotels 数组、所有 eligible rooms、调试信息）
- `output/latest-run.json` — 固定的最终凭证文件（面向 AI/自动化的紧凑摘要，不再内嵌大体积调试明细）

### 判断成功

读取 `output/latest-run.json`：

| 字段 | 说明 |
|------|------|
| `success` | true=执行完成 |
| `hotelName` | 酒店名（非空=页面抓取成功） |
| `eligibleCount` | 符合条件的房间数量（>0=有可用房型） |
| `eligibleRoomTypes` | 所有房型摘要，包含标准房型、原始房型、价格、人数、退改与窗户信息 |
| `eligibleHotels` | 可直接作为写入候选的完整酒店记录数组；复核通过后按它的结构写入比较助手即可 |
| `totalPrice` | 第一条记录的总价（非 null=有价格） |
| `ctripScore` | 携程评分 |
| `distance` / `transportTime` | 交通信息 |
| `subwayDistance` / `subwayStation` | 最近地铁站距离和站名 |

**成功**：success=true, eligibleCount>0, totalPrice 非空
**部分成功**：success=true, hotelName 非空, 但 totalPrice=null（价格被反爬拦截）
**失败**：success=false

## 技术约束

### 抓取流程（三层兜底）

```
默认：HTML 解析 (desktop/mobile)
  → API 重放 (direct-room-list-replay)
    → Edge-CDP (captureRoomCandidatesWithEdge)

显式启用 Edge 会话时：HTML 解析 (desktop/mobile)
  → Edge-CDP (captureRoomCandidatesWithEdge)
    → API 重放 (仅在 Edge 仍未拿到带价房型时才补试)
```

如果 HTML 已经拿到足够的带价合规房型，流程不会继续进入补抓。补抓阶段默认先走 direct replay；但在已经显式启用 Edge 会话的情况下，会优先走带登录态的 Edge-CDP，避免先撞更容易返回 203 的无登录 API。

只有当前结果缺价或明显不完整时才进入下一层。见 `src/ctrip-scraper.js` 的 `scrapeCtripHotel` 函数。

**重要**：携程对大量酒店会隐藏价格（显示"登录看低价"），前两层都是不带登录态的 HTTP 请求，**无法拿到被隐藏的价格**。只有 Edge-CDP 通过复用已登录的 Edge 浏览器标签页才能获取真实价格。

### edge-cdp 价格抓取

- edge-cdp 是获取实时价格的最终兜底，代码在 `src/ctrip-scraper.js` 的 `captureRoomCandidatesWithEdge`
- **标签页复用**：必须用 `Target.getTargets` → `Page.reload`，**禁止** `Target.createTarget` 新建标签页（触发反爬）
- **网络捕获时序**：必须先 `Network.enable` 再 `Page.reload`
- **价格字段格式多变**：可能是数字、字符串或嵌套对象。用 `unwrapPriceValue()` 递归展开
- **核心数据结构**：
  - `roomList[i].key` → `physicRoomMap[key]`（物理房间）
  - `subRoomList[j].skey` → `saleRoomMap[skey]`（可售房间）
  - 单晚价：`saleRoomMap[skey].priceInfo.price`（数字）
  - 总价：`saleRoomMap[skey].totalPriceInfo.total`（**对象**，如 `{content: "¥1,427"}`）
  - 价格锁定：`saleRoomMap[skey].bookingStatusInfo.isHidePrice`

### 房型筛选与标准化

- **多房型输出**：`selectMatchingRooms()` 筛选所有符合条件房间（有价格、人数默认精确匹配模板；若开启“3人模板时额外保留4人房”则允许 `3 -> 4`、standard_title 非空、score >= 0、走廊/过道窗视为无窗）
- 每个符合条件的房间生成独立的 hotel record
- 三人入住优先三床房、家庭房；原始标题若写“套房”，也必须先按床型归类后再参与匹配
- `deriveStandardRoomType()` 先走结构化 `bedInfo`，不足时再回退到 raw 文本；详细职责拆分见 `src/scraper/ROOM-TYPE-ARCHITECTURE.md`
- 如果以后要改“单张双人床”“沙发床”“套房”“二选一房型”等规则，优先改 `src/scraper/room-type-rules.js`，不要直接在筛选逻辑里零散补判断
- 同一房型多价格时保留列表，取最低价作为 daily_price
- 未成功标准化的房型不进入 eligible_rooms

### 高德交通查询

- 默认 Key：`90d578a0d57c9283aefd4424a7a6f267`
- `distance` / `subway_distance`：纯数字字符串，不带单位
- `subway_station`：最近地铁站名称（来自高德 POI 周边搜索 `types=150500`），独立字段，不要塞进 notes
- `transport_time`：分钟数，不带单位
- `bus_route`：多行换乘文本
- 起点/终点无法确认时留空并在 notes 写明原因

### 宾馆比较助手兼容

生成的记录包含以下字段：name, address, website, total_price, daily_price, check_in_date, check_out_date, days, ctrip_score, destination, distance, subway_station, subway_distance, transport_time, bus_route, room_type, original_room_type, room_count, room_area, notes, is_favorite, template_id, template_info。不得删减。

- `subway_station`：最近地铁站名称，由高德 POI 周边搜索自动填入
- `original_room_type`：携程平台原始房型名，**必须原封不动保留携程显示的名称**（如"商务大床房"不能写成"大床房"），标准化后的 `room_type` 另存
- `notes`：只记录限制、优缺点、早餐、退改等用户关心的信息，**不要**把税费、调试信息、付款担保信息（如"到店付·需担保"）、地铁站名、原始房型名塞进 notes
- `template_id`：数字类型，匹配失败时写 `null`

模板现在只按显式 `template_id` 或 `template_name` 精确匹配；不再根据日期、人数、目的地自动猜现有模板。显式模板未命中时，`template_id` 写 `null`。
模板与 CLI 的采集人数当前仍只支持 `1-3`；如果需要额外保留 `4` 人房，请使用 `3` 人模板并开启“3人模板时额外保留4人房”。

### 不能做的事

1. **不能伪造价格** — totalPrice 为 null 时在说明中注明原因即可
2. 不能跳过 latest-run.json 直接判断成功
3. 不能改坏宾馆比较助手的 schema
4. 不能绕开现有流程另起一套抓取逻辑

## 排查手册

### totalPrice 为 null

按顺序看 `latest-run.json` 中 `pageSnapshot.sources`：

1. **desktop/mobile** 源 `room_price_visible=false` → 正常，自动进入下一步
2. **direct-room-list-replay** 源 `error` 含 "203" → 正常，自动进入 edge-cdp
3. **edge-cdp** 源：
   - `room_candidates_count=0` → Edge 会话未成功捕获响应，检查 Edge 是否启动且调试端口可达
   - `room_price_visible=false` → 价格被锁定，需先改用可见 Edge 窗口手动打开酒店页，确认目标房型价格在登录态页面是否真实可见；可直接把采集命令加 `--edge-headless false`，或先运行 `node src/edge-session.js --login --userDataDir ./state/edge-profile --profileDirectory Default --port 9222 --url "携程链接"` 做人工验证
   - `room_price_visible=true` 但总价仍 null → 检查 `unwrapPriceValue()` 和 `extractStructuredRecordPrices()` 是否覆盖了携程返回的最新字段格式

### 价格提取函数

位于 `src/ctrip-scraper.js`：

1. **`unwrapPriceValue(value)`** — 递归展开价格值（数字/字符串/嵌套对象），遍历 content/amount/value/price/number/display/total 属性
2. **`extractStructuredRecordPrices(record)`** — 从 saleRoom 中提取所有可能的价格字段
3. **`buildCandidateFromRoomMapping()`** — 将 saleRoom 组装为房间候选

如果携程 API 新增了价格字段格式，需在上述函数中补充解析。

## 文件结构

```
src/
  cli.js              # CLI 入口
  ctrip-scraper.js    # 采集核心（HTML解析、API重放、edge-cdp）
  hotel-record.js     # 生成兼容比较助手的酒店记录
  edge-session.js     # Edge 调试会话管理
  amap.js             # 高德距离与交通查询
  compare-app-bridge.js  # 与比较助手数据对接
  template-loader.js  # 模板加载与合并
  constants.js        # 默认配置
  utils.js            # 工具函数
  scraper/
    room-logic.js              # 房型标准化接入层、候选房筛选与排序
    room-type-rules.js         # 房型关键词、床数统计、结构化/回退判定规则
    ROOM-TYPE-ARCHITECTURE.md  # 房型规则入口说明，后续优先看这里
examples/
  template.sample.json               # 示例模板文件
  template.edge-managed-session.json  # Edge 登录态模板样例
  template.实验.json                  # 实验模板
output/
  latest-run.json      # 最近一次采集的凭证文件
  <酒店名>.json        # 完整采集结果
  raw-pages/           # HTML 快照（调试用）
state/
  edge-profile/        # Edge 用户数据（含登录态，不要删除）
一键启动Edge并采集.bat  # 唯一推荐的 bat 入口
README.md
```

## 交接要求

后续 AI 接手时，应先阅读根目录的 `00-后续AI统一提示词.md`，再把本 README 当作运行手册使用。执行采集任务时按以下流程：

1. 用户给携程链接 + 模板名
2. 用 `node src/cli.js --url ... --templateName ... --edge-*` 采集（用 Node.js 运行，不要用 PowerShell 直接传 URL）
3. 读 `output/latest-run.json` 确认成功
4. 读 `output/<酒店名>.json` 查看详细房型
5. 按"房型过滤规则"过滤不合规房型
6. 将过滤后的数据写入 `E:\实验\1\宾馆比较助手\hotel-data.json`
7. 如需排查运行方式、抓取链路或价格回补问题，再回看本 README 对应章节
