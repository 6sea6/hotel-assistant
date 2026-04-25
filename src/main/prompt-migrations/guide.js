const { prependSection } = require('./helpers');

const GUIDE_COMPATIBILITY_MARKER = '## 安装版兼容修正';
const GUIDE_TEMPFILE_MARKER = '## 临时文件清理修正';
const GUIDE_SHELL_MARKER = '## PowerShell 兼容修正';

function migrateGuidePrompt(content) {
  let nextContent = String(content || '');

  nextContent = nextContent.replace(/、facilities/g, '');
  nextContent = nextContent.replace(/facilities、/g, '');
  nextContent = nextContent.replace(/\n- facilities: 用逗号、顿号都可以/g, '');
  nextContent = nextContent.replace(/、facilities、notes/g, '、notes');
  nextContent = nextContent.replace(/original_room_type、facilities、notes/g, 'original_room_type、notes');
  nextContent = nextContent.replace(/room_area、facilities、notes/g, 'room_area、notes');
  nextContent = nextContent.replace(/\n\s*"facilities": "WiFi、空调、早餐",/g, '');

  nextContent = nextContent.replace(
    '如果当前环境已经部署了 hotel-data-filler Skill，则采集命令、登录命令和输出路径都以该 Skill 末尾“打包版专用说明”为准，不要继续套开发机路径。开发环境下，采集器工作目录才是采集器项目根目录。',
    '环境判定优先于 Skill 名称本身：只有当打包版提示词与可执行/采集器资源路径真实存在时，才按 hotel-data-filler Skill 末尾“打包版专用说明”执行；否则直接按当前测试/开发工作区 E:\\实验\\2 的命令和输出路径运行，不要先尝试打包路径再回退。'
  );

  nextContent = nextContent.replace(
    '如果当前环境是打包版，则按 Skill 末尾“打包版专用说明”里的同等命令执行。',
    '如果已确认当前环境是完整打包版，则按 Skill 末尾“打包版专用说明”里的同等命令执行。'
  );

  nextContent = nextContent.replace(
    '2. 需要写入数据时，只允许直接修改现有数据文件中的 hotels、templates、settings 等既有结构。',
    '2. 需要写入数据时，优先通过程序现有桥接层、IPC 或采集器回写流程写回现有数据；不要手工直接编辑 hotel-data.json 中的 grouped/shared + rooms 落盘结构。'
  );

  nextContent = nextContent.replace(
    '你的目标是先判断"用户说的模板对应现有哪个模板"，从而知道本次住宿的目的地是什么。',
    '你的目标是先判断"用户说的模板对应现有哪个模板"，再决定本次住宿是否已有 destination；如果模板本身的 destination 为空，直接按无目的地场景处理，不要再追问用户补填。'
  );

  nextContent = nextContent.replace(
    '如果整家酒店所有候选房型都明确写了不可取消、不支持取消或确认后不可退改，整家酒店直接跳过；入住前一天免费取消和未明确写不能取消的，都按可取消处理',
    '如果整家酒店所有候选房型都明确写了不可取消、不支持取消、确认后不可退改，或只支持订单确认后 xx 分钟/xx 天内免费取消，整家酒店直接跳过；入住前一天免费取消和未明确写不能取消的，都按可取消处理'
  );

  nextContent = nextContent.replace(
    '- 家庭房、三床房都能住三人，但如果实际只住两人则 room_count 记 2\n- 只有用户明确说住几人才记几人，不要按房间最大容量自动填写',
    '- 家庭房、三床房都能住三人，但如果实际只住两人则 room_count 记 2\n- 如果采集结果里某个保留下来的房型明确显示可住 4 人，则该房型的 room_count 应记 4\n- 只有用户明确说住几人才记几人，不要按房间最大容量自动填写'
  );

  nextContent = nextContent.replace(
    '- 默认只提供 occupancy 等于模板 room_count 的房型（精确匹配，排除超员和不足）；如果比较助手设置里开启“3人模板时额外保留4人房”，则在 room_count=3 时也允许保留 occupancy=4 的房型',
    '- 默认只提供 occupancy 等于模板 room_count 的房型（精确匹配，排除超员和不足）；如果比较助手设置里开启“3人模板时额外保留4人房”，则在 room_count=3 时也允许保留 occupancy=4 的房型\n- 模板与 CLI 的采集人数当前仍只支持 1-3；如需额外保留 4 人房，只能使用 3 人模板并开启“3人模板时额外保留4人房”'
  );

  nextContent = nextContent.replace(
    '- room_count: 1、2、3',
    '- room_count: 1、2、3、4（其中模板/CLI 采集人数仍只支持 1、2、3）'
  );

  nextContent = nextContent.replace(
    '- 是否只修改现有数据文件，而没有新建任何额外文件',
    '- 是否避免手工直接编辑 hotel-data.json 的 grouped/shared + rooms 结构或手工拼接 hotels 数组'
  );

  nextContent = nextContent.replace(
    '工作目录为 E:\\实验\\2，采集器独立于本比较助手应用。采集完成后，将过滤后的房型数据写回当前数据文件。',
    '工作目录为 E:\\实验\\2，采集器独立于本比较助手应用。采集完成后，应通过桥接层或采集器提供的回写命令把最终复核后的房型写回当前数据文件。'
  );

  nextContent = nextContent.replace(
    '7. 将过滤后的房型追加到当前主数据文件的 hotels 数组中，不要手动编造 id、created_at、updated_at。',
    '7. 正常流程通过 node src/cli.js --apply-output "output/<酒店名>.json" 或等效桥接流程回写，不要手工直接修改 hotel-data.json，也不要手工编造 id、created_at、updated_at。'
  );

  if (nextContent.includes('让桥接层负责展开、判重和重新压缩。')
    && !nextContent.includes('回写时只判断“本次准备写入的房型”是否与已有记录重复')) {
    nextContent = nextContent.replace(
      '让桥接层负责展开、判重和重新压缩。',
      '让桥接层负责展开、判重和重新压缩。\n\n回写时只判断“本次准备写入的房型”是否与已有记录重复；如果历史房型没有出现在本次输出里，也不要自动删除或清理，除非用户明确要求清理旧数据。'
    );
  }

  if (nextContent.includes('模板匹配优先级：\n1. name、check_in_date、check_out_date、room_count、destination 同时匹配\n2. check_in_date、check_out_date、room_count、destination 匹配\n3. 用户明确指出使用某个现有模板名称时，按模板名称和日期交叉核对')) {
    nextContent = nextContent.replace(
      '模板匹配优先级：\n1. name、check_in_date、check_out_date、room_count、destination 同时匹配\n2. check_in_date、check_out_date、room_count、destination 匹配\n3. 用户明确指出使用某个现有模板名称时，按模板名称和日期交叉核对',
      '模板只按显式 template_id 或 template_name 精确匹配：\n1. 用户给了 template_id 时，按 id 精确匹配\n2. 用户给了 template_name 时，按模板名称精确匹配\n3. 不要再根据日期、人数、目的地自动猜现有模板'
    );
  }

  if (nextContent.includes('匹配失败时：\n- template_id 写 null\n- template_info 写 null\n- destination 再根据用户给出的目的地单独填写\n- 不要因为匹配失败而创建新的模板文件\n\n## 用户提供模板时的处理规则')
    && !nextContent.includes('如果最终匹配到的模板 destination 为空：')) {
    nextContent = nextContent.replace(
      '匹配失败时：\n- template_id 写 null\n- template_info 写 null\n- destination 再根据用户给出的目的地单独填写\n- 不要因为匹配失败而创建新的模板文件\n\n## 用户提供模板时的处理规则',
      '匹配失败时：\n- template_id 写 null\n- template_info 写 null\n- destination 再根据用户给出的目的地单独填写\n- 不要因为匹配失败而创建新的模板文件\n\n如果最终匹配到的模板 destination 为空：\n- 这是合法场景，不要报模板缺字段错误\n- 不要追问用户补 destination，也不要因为 destination 为空就判定模板匹配失败\n- destination 允许保持空字符串\n- 只查询宾馆附近地铁站\n- distance、transport_time、bus_route 留空\n\n## 用户提供模板时的处理规则'
    );
  }

  if (nextContent.includes('- 不要因为匹配失败而创建新的模板文件')
    && !nextContent.includes('CLI 也不再默认套用 bw。用户没有明确给模板时，必须自己提供 check_in_date、check_out_date、room_count；如果需要计算路线，再额外提供 destination。')) {
    nextContent = nextContent.replace(
      '- 不要因为匹配失败而创建新的模板文件',
      '- 不要因为匹配失败而创建新的模板文件\n\nCLI 也不再默认套用 bw。用户没有明确给模板时，必须自己提供 check_in_date、check_out_date、room_count；如果需要计算路线，再额外提供 destination。'
    );
  }

  if (nextContent.includes('- transport_time 是否基于"宾馆地址 -> 已确认目的地"的公共交通时间\n- 最近地铁站名称是否写入了 subway_station，而不是塞进 notes')
    && !nextContent.includes('- 若匹配模板的 destination 为空，是否保持 destination 为空并只保留最近地铁站信息')) {
    nextContent = nextContent.replace(
      '- transport_time 是否基于"宾馆地址 -> 已确认目的地"的公共交通时间\n- 最近地铁站名称是否写入了 subway_station，而不是塞进 notes',
      '- transport_time 是否基于"宾馆地址 -> 已确认目的地"的公共交通时间\n- 若匹配模板的 destination 为空，是否保持 destination 为空并只保留最近地铁站信息\n- 最近地铁站名称是否写入了 subway_station，而不是塞进 notes'
    );
  }

  if (!nextContent.includes(GUIDE_COMPATIBILITY_MARKER)) {
    nextContent = prependSection(nextContent, GUIDE_COMPATIBILITY_MARKER, `${GUIDE_COMPATIBILITY_MARKER}
1. 当前测试/开发环境默认直接使用工作区 E:\\实验\\2，不要因为已经安装 hotel-data-filler Skill 就先尝试打包路径。
2. 只有当 E:\\实验\\hotel-comparison-app\\宾馆比较助手\\scraper-data\\00-后续AI统一提示词.md 与 E:\\实验\\hotel-comparison-app\\宾馆比较终极版.exe 或 E:\\实验\\hotel-comparison-app\\resources\\scraper\\src\\cli.js 真实存在时，才按 Skill 末尾“打包版专用说明”执行。
3. 如果打包版提示词或资源路径不存在，直接按当前测试/开发环境处理，不要先尝试打包路径再回退。
4. 打包安装版默认数据目录优先位于程序安装目录下的 宾馆比较助手 文件夹；如果用户在程序里迁移过，再以程序当前显示路径或 %APPDATA%/hotel-app-pointer.json 指针为准，不要默认回到 %APPDATA%。
5. 磁盘上的 hotel-data.json 可能是 grouped 结构，每项包含 shared 和 rooms。不要手工只改 shared.name 或 shared.website 后沿用旧 rooms。
6. 复核通过后，不要手工直接修改 hotel-data.json；优先执行桥接回写命令：

\`\`\`
node src/cli.js --apply-output "output/<酒店名>.json"
\`\`\`

如果已确认当前环境是完整打包版，则按 Skill 末尾“打包版专用说明”里的同等命令执行。
7. --auto-edge 首次使用若未检测到可复用的 Edge profile，会先弹出一次可见 Edge 登录准备窗口；登录后关闭窗口，当前任务再继续后台采集。新设备通常仍需要至少这一次登录准备，不能完全跳过。
8. 如果怀疑某家酒店只有在登录态的可见 Edge 页面里手动打开后，目标房型价格才会真正显示出来，不要只在后台连续重试；应先改用可见窗口重试一次，可给采集命令追加 --edge-headless false，或先运行 edge-session.js --login --url 命令，确认页面上目标房型价格已可见，再继续采集。`);
  }

  if (!nextContent.includes(GUIDE_TEMPFILE_MARKER)) {
    nextContent = prependSection(nextContent, GUIDE_TEMPFILE_MARKER, `${GUIDE_TEMPFILE_MARKER}
1. 如果打包版流程为了执行命令临时写入了 _run.js 等脚本，清理时统一在 Node.js 进程内使用 fs.unlinkSync() 或 fs.rmSync({ recursive: true, force: true })。
2. 不要在 PowerShell 或 cmd 层再用 Remove-Item、del 清理这些临时文件，避免确认提示和壳层差异。`);
  }

  if (!nextContent.includes(GUIDE_SHELL_MARKER)) {
    nextContent = prependSection(nextContent, GUIDE_SHELL_MARKER, `${GUIDE_SHELL_MARKER}
1. 如果必须在 PowerShell 里把 Set-Location、环境变量设置、node 命令写成一行，统一使用分号 ;，不要使用 &&，以兼容 Windows PowerShell 5.x。
2. 本地开发模式下，E:\\实验\\2 里的采集器默认优先读取同级工作区 E:\\实验\\1\\宾馆比较助手；如需强制切换模板/数据源，可设置环境变量 HOTEL_COMPARE_APP_DATA_DIR。`);
  }

  return nextContent;
}

module.exports = {
  GUIDE_COMPATIBILITY_MARKER,
  GUIDE_SHELL_MARKER,
  GUIDE_TEMPFILE_MARKER,
  migrateGuidePrompt
};
