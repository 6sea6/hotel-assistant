# 房型规则结构说明

这份说明只覆盖“房型标准化”这条链路，目的是让后续修改时能直接找到入口，不必再从 `room-logic.js` 全文倒推。

## 职责拆分

- `src/scraper/room-type-rules.js`
  - 纯规则层
  - 负责床型关键词、床数统计、标题提示词、结构化床型判定、fallback 判定
  - 这里适合修改“单张双人床”“沙发床”“套房”“二选一房型”这类规则
- `src/scraper/room-logic.js`
  - 流程层
  - 负责候选房合并、从 raw 中提取 `bedSummary`、调用规则层、房型匹配打分、最终筛选
  - 这里适合修改“怎么取原始字段”“怎么给候选房排序/过滤”
- `tests/room-type-rules.test.js`
  - 规则级回归
  - 新增关键词或调整优先级时，优先补这里
- `tests/room-logic.test.js`
  - 流程级回归
  - 用来确认规则接入 `deriveStandardRoomType()` 后整条链路没被带坏

## 当前判定链路

1. `deriveStandardRoomType()` 先调用 `tryParseBedInfo()`
2. `tryParseBedInfo()` 从 `physicalRoom.bedInfo.title` 和 `houseTypeInfo.bedCount` 取结构化信号
3. 结构化信号交给 `deriveRoomTypeFromStructuredBed()`
4. 如果结构化信息不够，再由 `extractBedSummary()` 从 raw 文本提取 `bedSummary`
5. fallback 文本交给 `deriveRoomTypeFromFallbackSignals()`

优先级是：`结构化 bedInfo > raw fallback`

## 当前关键规则

- `沙发床` 视为 `单人床`
- `大床/特大床 + 沙发床` 归 `家庭房`
- `1张双人床` 不再默认归 `双床房`
  - 标题明确是 `大床房`，或 `bedCount = 1` 时，归 `大床房`
  - 明确是多张床时才归 `双床房`
- `1张大床 或 1张双人床` 视为单床规格随机，归 `大床房`
- `2张双人床` 归 `双床房`
- `2张大床/特大床` 也归 `双床房`
- `1张大床 或 2张单人床` 归 `大床房/双床房`
- 标题含 `套房` 时，仍然继续按实际床型落到 `大床房 / 双床房 / 家庭房 / 大床房/双床房`

## 修改入口建议

- 想加新床型关键词：改 `room-type-rules.js`
- 想调整“哪条规则优先”：改 `room-type-rules.js`
- 想改 raw 中抓哪段床型文本：改 `room-logic.js` 里的 `extractBedSummary()`
- 想改模板匹配分数或最终筛选：改 `room-logic.js` 里的 `rankRoomMatch()`、`selectMatchingRooms()`

## 安全修改清单

1. 先在 `tests/room-type-rules.test.js` 补最小回归
2. 如果会影响 `deriveStandardRoomType()` 的最终输出，再补 `tests/room-logic.test.js`
3. 运行 `npm test`
4. 如果是已知真实酒店误判，尽量再用真实样本复核一次
