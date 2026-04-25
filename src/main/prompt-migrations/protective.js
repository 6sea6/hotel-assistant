const { prependSection } = require('./helpers');

const PROTECTIVE_COMPATIBILITY_MARKER = '## 存储兼容修正';

function migrateProtectivePrompt(content) {
  let nextContent = String(content || '');

  if (!nextContent.includes(PROTECTIVE_COMPATIBILITY_MARKER)) {
    nextContent = prependSection(nextContent, PROTECTIVE_COMPATIBILITY_MARKER, `${PROTECTIVE_COMPATIBILITY_MARKER}
1. 打包安装版默认数据目录优先位于程序安装目录下的 宾馆比较助手 文件夹；如果用户迁移过，再以 %APPDATA%/hotel-app-pointer.json 指针为准。
2. 当前磁盘上的 hotel-data.json 可能是 grouped 存储结构，每条酒店记录由 shared 公共字段和 rooms 房型数组组成。
3. 不要手工只修改 shared 层字段后复用旧 rooms；这会造成“酒店名是新的，但房型和价格还是上一次数据”的混写。
4. 采集结果回写比较助手时，优先使用采集器桥接命令或程序现有接口，不要直接手改 grouped 结构。`);
  }

  nextContent = nextContent.replace(/、facilities、notes/g, '、notes');
  nextContent = nextContent.replace(/room_area、facilities、notes/g, 'room_area、notes');

  return nextContent;
}

module.exports = {
  PROTECTIVE_COMPATIBILITY_MARKER,
  migrateProtectivePrompt
};
