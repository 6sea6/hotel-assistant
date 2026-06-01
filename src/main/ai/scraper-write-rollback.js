const fs = require('fs');
const path = require('path');
const { loadScraperModule } = require('./scraper-paths');
const { emitScraperEvent } = require('./scraper-task-input');

async function createWriteRollbackSnapshot(scraperPath, rollbackState = {}) {
  if (rollbackState.created) {
    return rollbackState;
  }

  const bridge = await loadScraperModule(scraperPath, 'compare-app-bridge.js');
  const storePath = bridge.getCompareAppStorePath();
  rollbackState.created = true;
  rollbackState.restored = false;
  rollbackState.storePath = storePath;
  rollbackState.storeExisted = fs.existsSync(storePath);
  rollbackState.snapshotJson = rollbackState.storeExisted ? fs.readFileSync(storePath, 'utf8') : '';

  return rollbackState;
}

function restoreWriteRollbackSnapshot(rollbackState = {}, context = {}) {
  if (!rollbackState.created || rollbackState.restored || !rollbackState.storePath) {
    return null;
  }

  emitScraperEvent(context, 'write:rollback-start', '任务已取消，正在撤销本次已写回的数据', {
    storePath: rollbackState.storePath
  });

  if (rollbackState.storeExisted) {
    fs.mkdirSync(path.dirname(rollbackState.storePath), { recursive: true });
    fs.writeFileSync(rollbackState.storePath, rollbackState.snapshotJson || '', 'utf8');
  } else if (fs.existsSync(rollbackState.storePath)) {
    fs.unlinkSync(rollbackState.storePath);
  }

  rollbackState.restored = true;
  const result = {
    restored: true,
    storePath: rollbackState.storePath,
    storeExisted: Boolean(rollbackState.storeExisted)
  };
  emitScraperEvent(context, 'write:rollback-done', '已撤销本次取消任务的写回数据', result);

  return result;
}

module.exports = {
  createWriteRollbackSnapshot,
  restoreWriteRollbackSnapshot
};
