const {
  HOTEL_EDITABLE_FIELDS,
  HOTEL_SYSTEM_FIELDS,
  TEMPLATE_FIELDS,
  getVersionTag,
  toFieldKeyList,
  toFieldSchemaSummary
} = require('./shared');

function buildGuidePrompt({ dataPath = '未获取到数据路径' } = {}) {
  return `# 宾馆比较助手 AI 数据填写指南 ${getVersionTag()}

## 你的任务
根据用户提供的宾馆信息，稳定补全或更新本地数据。目标是让数据能直接被程序使用、排序和筛选。

## 当前数据位置
- 主数据文件：${dataPath}
- AI 提示词文件：与主数据同目录下的 ai-prompts.json
- 安装版默认数据目录：程序安装目录下的 宾馆比较助手/
- 开发环境回退目录：%APPDATA%/宾馆比较助手/
- 如果用户已迁移数据位置，则以程序当前显示的数据路径或 %APPDATA%/hotel-app-pointer.json 指针为准，不要假设路径固定不变
- 现有模板数据：保存在主数据文件的 templates 数组内
- 现有宾馆数据：逻辑上保存在主数据文件的 hotels 数据中；磁盘层可能以 grouped 结构压缩存储
- 本地开发模式下，\`E:\\实验\\2\` 里的采集器默认优先读取同级工作区 \`E:\\实验\\1\\宾馆比较助手\`；如需强制切换数据源，可设置环境变量 \`HOTEL_COMPARE_APP_DATA_DIR\`
- 当前测试/开发环境默认直接使用工作区 \`E:\\实验\\2\`，不要因为已经安装 \`hotel-data-filler\` Skill 就先尝试打包路径
- 只有当 \`E:\\实验\\hotel-comparison-app\\宾馆比较助手\\scraper-data\\00-后续AI统一提示词.md\` 与 \`E:\\实验\\hotel-comparison-app\\宾馆比较终极版.exe\` 或 \`E:\\实验\\hotel-comparison-app\\resources\\scraper\\src\\cli.js\` 真实存在时，才按 Skill 末尾“打包版专用说明”执行

## 文件操作要求
1. 不要新建任何额外的数据文件、模板文件、缓存文件或临时 JSON 文件。
2. 需要写入数据时，优先通过现有桥接命令或程序接口写入；不要手工直接改磁盘上的 grouped hotel-data.json。
3. 需要修改提示词时，只修改当前 ai-prompts.json 中对应类型的 content。
4. 如果信息不足，不要通过新建文件兜底，也不要为了占位伪造一份模板数据。

## 磁盘存储结构提醒
- 当前磁盘上的 hotels 可能是分组压缩结构：每项包含 shared 公共字段和 rooms 房型数组。
- 如果你只改 shared.name、shared.website 等公共字段，却复用了旧的 rooms，就会出现“酒店名是新的，但房型/价格还是上一次数据”的错误。
- 复核后的采集结果不要手工编辑 hotel-data.json；优先使用采集器桥接命令

\`\`\`
node src/cli.js --apply-output "output/<酒店名>.json"
\`\`\`

让桥接层负责展开、判重和重新压缩。

回写时只判断“本次准备写入的房型”是否与已有记录重复；如果历史房型没有出现在本次输出里，也不要自动删除或清理，除非用户明确要求清理旧数据。

## 填写原则
1. 缺失字段可留空，不要伪造信息。
2. 用户已经提供的信息不要漏填，尤其是 address、website、subway_station、subway_distance、bus_route、original_room_type、room_area、notes、is_favorite。
3. 距离、交通时间、面积等建议写纯数字字符串，避免混入单位，程序界面会补单位。
4. 日期统一写 YYYY-MM-DD。
5. template_id 为空时写 null；若关联模板，template_info 要与模板内容一致。
6. 收藏状态统一使用 0 或 1。
7. notes 用于补充限制、优缺点、早餐、退改、接驳、价格获取情况等关键信息，不要把税费、最近地铁站名称、原始房型名或调试噪音塞进 notes。
8. total_price、daily_price、days、ctrip_score、room_count 等可计算字段尽量写成数字或 null。

## 宾馆可填写字段总表
以下字段都属于可填写范围，AI 不要只填写其中一部分：
${toFieldSchemaSummary(HOTEL_EDITABLE_FIELDS)}

以下字段属于系统字段，不要手动伪造：
${toFieldSchemaSummary(HOTEL_SYSTEM_FIELDS)}

## 现有模板识别规则
你必须先读取主数据文件中的 templates 数组，确认当前已有模板，再决定如何填写 template_id、template_info、destination。

每次新任务、每次重新执行采集命令前，都必须重新读取一次当前主数据文件中的 templates 数组。
- 不要复用上一轮任务、上一家酒店、上一条消息、上一份 latest-run.json，或你记忆里的模板参数
- 即使模板名称相同，也必须先重新读取当前 templates，再确认它现在的日期、人数、目的地
- 只有在“刚刚重新读取并成功匹配当前模板”之后，才能说“模板参数已确认/已知”
- 一旦用户提到自己刚改过模板，必须把旧记忆直接作废，以当前磁盘里的 templates 为唯一准绳

现有模板字段至少包括：
${toFieldKeyList(TEMPLATE_FIELDS)}

模板只按显式 template_id 或 template_name 精确匹配：
1. 用户给了 template_id 时，按 id 精确匹配
2. 用户给了 template_name 时，按模板名称精确匹配
3. 不要再根据日期、人数、目的地自动猜现有模板

匹配成功时：
- 直接复用该模板的 id 写入 template_id
- 按该模板当前内容写入 template_info
- destination 优先采用已匹配模板的 destination，保持与模板一致

匹配失败时：
- template_id 写 null
- template_info 写 null
- destination 再根据用户给出的目的地单独填写
- 不要因为匹配失败而创建新的模板文件

CLI 也不再默认套用 bw。用户没有明确给模板时，必须自己提供 check_in_date、check_out_date、room_count；如果需要计算路线，再额外提供 destination。

如果最终匹配到的模板 destination 为空：
- 这是合法场景，不要报模板缺字段错误
- 不要追问用户补 destination，也不要因为 destination 为空就判定模板匹配失败
- destination 允许保持空字符串
- 只查询宾馆附近地铁站
- distance、transport_time、bus_route 留空

## 用户提供模板时的处理规则
如果用户告诉你"用某个模板"或给出一组模板信息，你要先把用户提供的信息与现有 templates 数组逐项匹配，而不是直接假设这是一个全新模板。

如果你之前在同一轮对话里已经见过同名模板，也不能直接沿用当时的参数；必须重新读取当前 templates 后，再判断这个模板现在是不是仍然相同。

重点比对字段：
- 模板名称
- 目的地
- 入住日期
- 离店日期
- 房间数

你的目标是先判断"用户说的模板对应现有哪个模板"，再决定本次住宿是否已有 destination；如果模板本身的 destination 为空，直接按无目的地场景处理，不要再追问用户补填。

## 房型标准化规则（room_type 填写时必须遵守）
- 双床房：两张床必须一样大。携程标题含"双人房"的，如"标准双人房"，应标准化为"双床房"
- 家庭房：床型不一致的房型归为家庭房，如双人床加单人床。携程"精品双床房"如果实际是一张双人床加一张单人床，应归为"家庭房"，不是"双床房"
- 二选一房型："1张大床 或 2张单人床"等存在两种可能的房型，标准化为"大床房/双床房"，不能判为家庭房
- 大床房：一张大床，如"商务大床房""精品大床房"
- 三床房：三张床的房型。room_type 不存在"三人房"，携程标题含"三人房"的统一归为"三床房"
- 标题含"套房"的房型按床型识别：大床→大床房，双床→双床房；如果床型识别不出来，先复核，不要直接输出"套房"
- original_room_type：携程平台原始展示房型名，必须原封不动保留

### room_count（入住人数）填写规则
- room_count 记录的是实际入住人数，不是房间最大容量
- 家庭房、三床房都能住三人，但如果实际只住两人则 room_count 记 2
- 如果采集结果里某个保留下来的房型明确显示可住 4 人，则该房型的 room_count 应记 4
- 只有用户明确说住几人才记几人，不要按房间最大容量自动填写

### 房型筛选规则（采集或写入时必须遵守）
- 默认只提供 occupancy 等于模板 room_count 的房型（精确匹配，排除超员和不足）；如果比较助手设置里开启“3人模板时额外保留4人房”，则在 room_count=3 时也允许保留 occupancy=4 的房型
- 模板与 CLI 的采集人数当前仍只支持 1-3；如需额外保留 4 人房，只能使用 3 人模板并开启“3人模板时额外保留4人房”
- 如果携程显示某房型"3人入住"且不支持 2 人，应排除该房型，不要写入比较助手
- 标注"无窗"、"部分有窗"的房型直接排除，不写入比较助手
- "窗户位于走廊或过道"视为无窗，同样排除
- 如果整家酒店所有候选房型都明确写了不可取消、不支持取消、确认后不可退改，或只支持订单确认后 xx 分钟/xx 天内免费取消，整家酒店直接跳过；入住前一天免费取消和未明确写不能取消的，都按可取消处理

## 公共交通时间填写规则
transport_time 表示"宾馆地址 到 目的地"之间的公共交通时间，单位为分钟，保存时只写数字字符串，例如 28。

## 最近地铁站距离与公交路线填写规则
- subway_station 表示距离宾馆最近的地铁站名称，例如 徐泾东站；如果用户提供了站名，应优先写入 subway_station，而不是写进 notes。
- subway_distance 表示"宾馆 到 最近地铁站"的距离，保存时写数字字符串，例如 0.6。
- 如果 subway_distance 为 0，表示无较近地铁站，界面应显示"无较近地铁站"。
- 如果最近地铁站距离超过 1.5km，也统一按无较近地铁站处理：subway_station 写 无，subway_distance 写 0。
- bus_route 表示从宾馆前往目的地时推荐填写的公交、地铁或步行路线，支持多行填写，便于完整记录步行、换乘、出站等步骤。
- **步行优先规则**：如果步行时间短于公交时间，则 bus_route 填步行路线（如"步行854米"），transport_time 填步行时间。
- 如果用户给了公交方案，不要只写 transport_time，要把路线文本同步写入 bus_route。
- 如果用户给了平台原始房型名，要优先写入 original_room_type，不要混在 notes。
- 如果用户没有给出路线，但已知起点和终点，可根据查询结果补全 bus_route。
- subway_distance 会用于界面筛选，重点档位为无、300米、500米、1km、1.5km；填写时保持可解析的数字字符串即可。

当用户没有直接给出 transport_time 时，按以下顺序判断：
1. 先通过模板匹配确定目的地，优先使用匹配模板中的 destination
2. 起点使用宾馆的 address；若 address 不完整，可结合宾馆 name 与 address 理解位置，但写入时仍保留原 address
3. 终点使用已确认的 destination
4. 根据这两个地点，估算或查询两地间乘坐公共交通所需时间
5. 最终只把分钟数字写入 transport_time，不要写"分钟""min""约"等文字

如果起点或终点无法确定：
- transport_time 留空
- 在 notes 简要写明原因，如"目的地未确认，公共交通时间待补"

## 价格与备注填写规则
- 如果同一房型存在多个套餐价格，daily_price 优先取最低有效价
- displayPrice、totalPrice、payAmount 等值为 0 时，视为隐藏价或未展示，不代表免费
- 不能把退改罚金、担保金额或设施收费误当作房价
- 如果最终房价已通过 api-json、edge-cdp 等渠道补回，notes 应如实说明价格来源已补回
- 如果最终仍未拿到可用房价，允许 total_price、daily_price 为 null，并在 notes 说明原因

## 推荐填写模板
### 新增宾馆
- name: 必填
- address: 详细到街道或商圈更好
- website: 如果用户给了链接，必须填写到 website
- total_price: 总价
- daily_price: 若已知可直接给出，否则可由总价和天数推算
- check_in_date/check_out_date/days: 三者尽量保持一致
- ctrip_score: 如有评分信息应填写
- destination: 统一写本次出行核心目的地
- distance: 例如 2.5
- subway_station: 例如 徐泾东站
- subway_distance: 例如 0.8；若无较近地铁站则写 0
- transport_time: 例如 28
- bus_route: 支持多行，例如第 1 行写步行到站，第 2 行写乘坐线路，第 3 行写出站后步行
- room_type: 大床房、双床房、大床房/双床房、家庭房、三床房
- original_room_type: 平台原始展示房型名，例如三人间、商务双床房
- room_count: 1、2、3、4（其中模板/CLI 采集人数仍只支持 1、2、3）
- room_area: 例如 32
- notes: 记录优缺点与限制
- is_favorite: 默认为 0；只有用户明确要求收藏时写 1

### 更新宾馆
- 优先保留原有 id
- 未修改的字段不要随意清空
- 若模板已关联，不要随意删除 template_id 和 template_info
- 若用户提供了模板线索，先和现有 templates 数组匹配，再决定是否更新 destination 和 transport_time
- 若原记录已有 website、address、subway_station、subway_distance、bus_route、original_room_type、notes 等字段，用户未要求删除时不要清空

## 输出建议
如果 AI 需要代填数据，优先返回结构化 JSON，并遵守以下格式：

\`\`\`json
{
  "name": "宾馆名称",
  "address": "地址",
  "website": "https://example.com",
  "total_price": 1280,
  "daily_price": 426.67,
  "check_in_date": "2026-07-09",
  "check_out_date": "2026-07-12",
  "days": 3,
  "ctrip_score": 4.7,
  "destination": "上海国家会展中心",
  "distance": "2.6",
  "subway_station": "徐泾东站",
  "subway_distance": "0.8",
  "transport_time": "25",
  "bus_route": "步行8分钟至徐泾东站，乘地铁2号线直达",
  "room_type": "双床房",
  "original_room_type": "商务双床房",
  "room_count": 2,
  "room_area": "32",
  "notes": "可免费取消，含双早",
  "is_favorite": 1,
  "template_id": null,
  "template_info": null
}
\`\`\`

## 质量检查
提交前核对：
- 是否缺少 name
- 是否漏填了用户明确提供的 address、website、subway_station、subway_distance、bus_route、original_room_type、room_area、notes、is_favorite
- 日期与天数是否一致
- total_price 与 daily_price 是否明显矛盾
- 数值字段是否写成了无法解析的文本
- 模板关联是否完整
- 是否先读取了主数据文件中的 templates 数组再填写 template_id 和 template_info
- transport_time 是否基于"宾馆地址 -> 已确认目的地"的公共交通时间
- 若匹配模板的 destination 为空，是否保持 destination 为空并只保留最近地铁站信息
- 最近地铁站名称是否写入了 subway_station，而不是塞进 notes
- 原始房型名是否写入了 original_room_type，而不是塞进 notes
- notes 是否避免混入调试信息、地铁站名、原始房型名和付款担保信息
- 是否避免手工直接编辑 hotel-data.json 的 grouped/shared + rooms 结构或手工拼接 hotels 数组

## 采集器流程（当用户要求采集携程酒店时使用）

环境判定优先于 Skill 名称本身：只有当打包版提示词与可执行/采集器资源路径真实存在时，才按 hotel-data-filler Skill 末尾“打包版专用说明”执行；否则直接按当前测试/开发工作区 E:\\实验\\2 的命令和输出路径运行，不要先尝试打包路径再回退。

### 执行步骤
1. 先读取当前环境中的统一提示词文件和当前主数据文件中的 templates 数组；缺任一条件时，停止并汇报。
   - 如果用户指定了模板名或模板 ID，读取后先回显本次实际匹配到的模板快照：id、name、destination、check_in_date、check_out_date、room_count。
   - 在没有完成这一步之前，不要说“模板参数已知”“按既有模板执行”之类的话。
   - 如果重新读取后发现模板内容和你前面记忆的不一致，必须立即以最新模板覆盖旧判断，并明确说明“模板已按当前数据重新读取”。
2. 用 Node.js 运行采集命令（不要用 PowerShell 直接传 URL，& 符号会被误解析；如果必须把多条 PowerShell 命令写成一行，使用 \`;\`，不要使用 \`&&\`）：
   
\`\`\`
node src/cli.js --url "携程链接" --templateName 模板名 --auto-edge --edge-user-data-dir ./state/edge-profile --edge-profile-directory Default --edge-debugging-port 9222
\`\`\`

如果打包版流程为了执行命令临时写入了 _run.js 等脚本，清理时统一在 Node.js 进程内使用 fs.unlinkSync() 或 fs.rmSync({ recursive: true, force: true })；不要在 PowerShell 或 cmd 层再用 Remove-Item、del。

3. --auto-edge 会后台隐藏启动临时 Edge，会话采集完成后自动关闭。首次使用如果还没有可复用的 Edge profile，CLI 会先自动打开一次可见 Edge 窗口让用户登录携程；登录完成后关闭该窗口，当前任务再继续后台采集。新设备或新 profile 通常仍需要至少这一次登录准备，不能完全跳过。只有用户明确要求手动排障或重新登录时，才单独使用可见的登录命令：

\`\`\`
node src/edge-session.js --login --userDataDir ./state/edge-profile --profileDirectory Default --port 9222 --url "桌面版携程链接"
\`\`\`

如果怀疑某家酒店只有在登录态的可见 Edge 页面里手动打开后，目标房型价格才会真正显示出来，不要只在后台连续重试；应先用可见窗口重新尝试一次，可直接给采集命令追加 --edge-headless false，或先运行上面的 edge-session.js --login --url 命令，确认页面上目标房型价格已可见，再继续采集。

4. 读取 output/latest-run.json 判断结果：
  - success=false：停止，不写入。
  - success=true 但 eligibleCount=0：停止，不写入。
  - success=true 但 totalPrice=null：只汇报“部分成功，价格未拿到”，不写入。
  - success=true 且 eligibleCount>0 且 totalPrice!=null：继续。
5. 读取 output/<酒店名>.json 的 hotels 和 scrape_debug.eligible_rooms，按本提示词的房型过滤规则复核。
6. 正常流程不要使用 --write-app-data。只有用户明确接受未复核直写风险时，才允许与 --unsafe-allow-unreviewed-write 一起使用。
7. 复核通过后，不要手工直接修改 hotel-data.json；改为执行桥接回写命令：

\`\`\`
node src/cli.js --apply-output "output/<酒店名>.json"
\`\`\`

如果已确认当前环境是完整打包版，则按 hotel-data-filler Skill 末尾“打包版专用说明”里的同等命令执行。这样会由桥接层安全写入比较助手，避免 grouped/shared+rooms 结构被写坏。`;
}

module.exports = {
  buildGuidePrompt
};
