const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fingerprint(value) {
  const normalize = (item) =>
    Array.isArray(item)
      ? item.map(normalize)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, normalize(item[key])])
          )
        : item;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
}

class TaskCheckpoint {
  constructor(directory, id, query, resume = false) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('无效的恢复任务编号');
    this.id = id;
    this.directory = path.join(directory, id);
    this.queryHash = fingerprint(query);
    this.completed = new Map();
    this.startedAt = Date.now();
    this.pausedDurationMs = 0;
    this.expandedInputs = null;
    this.enabled = resume;
    if (resume) {
      const saved = JSON.parse(fs.readFileSync(path.join(this.directory, 'manifest.json'), 'utf8'));
      if (saved.queryHash !== this.queryHash) throw new Error('查询条件已变化，请作为新任务执行。');
      this.resumedAt = Date.now();
      this.previousPausedAt = saved.pausedAt;
      this.expandedInputs = saved.expandedInputs;
      this.startedAt = saved.startedAt || this.startedAt;
      this.pausedDurationMs =
        (saved.pausedDurationMs || 0) + Math.max(0, Date.now() - (saved.pausedAt || Date.now()));
      for (const key of saved.completedKeys) {
        if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('任务进度文件损坏');
        this.completed.set(
          key,
          JSON.parse(fs.readFileSync(path.join(this.directory, `${key}.json`), 'utf8'))
        );
      }
    }
  }
  get(key) {
    const item = this.completed.get(key);
    if (!item) return null;
    const value = structuredClone(item);
    value.result.restoredFromCheckpoint = true;
    value.result.resumedFromCheckpoint = value.result.writeCommitted === true;
    return value;
  }
  record(key, preparedResult) {
    const result = preparedResult.result;
    if (
      result?.success !== true ||
      result.accessIssue ||
      result.pageSnapshot?.spider_error_codes?.includes(203) ||
      result.pageSnapshot?.sources?.some((source) => source.spider_error_codes?.includes(203)) ||
      result.pageSnapshot?.login_required ||
      !result.pageSnapshot?.capture_complete
    )
      return;
    this.completed.set(key, preparedResult);
    if (this.enabled) {
      this.writeEntry(key, preparedResult);
      this.writeManifest();
    }
  }
  markWritten(key) {
    const value = this.completed.get(key);
    if (!value) return;
    value.result.writeCommitted = true;
    if (this.enabled) this.writeEntry(key, value);
  }
  writeEntry(key, value) {
    const filename = path.join(this.directory, `${key}.json`);
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(value), 'utf8');
    fs.renameSync(`${filename}.tmp`, filename);
  }
  writeManifest() {
    const filename = path.join(this.directory, 'manifest.json');
    fs.writeFileSync(
      `${filename}.tmp`,
      JSON.stringify({
        startedAt: this.startedAt,
        pausedAt: this.pausedAt || null,
        pausedDurationMs: this.pausedDurationMs,
        queryHash: this.queryHash,
        completedKeys: [...this.completed.keys()],
        expandedInputs: this.expandedInputs
      }),
      'utf8'
    );
    fs.renameSync(`${filename}.tmp`, filename);
  }
  pause(expandedInputs) {
    this.pausedAt = Date.now();
    this.enabled = true;
    this.expandedInputs = expandedInputs || this.expandedInputs;
    fs.mkdirSync(this.directory, { recursive: true });
    for (const [key, value] of this.completed) this.writeEntry(key, value);
    this.writeManifest();
  }
}

function markCheckpointWritten(directory, id, key) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(key || '')) return;
  const filename = path.join(directory, id, `${key}.json`);
  if (!fs.existsSync(filename)) return;
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  value.result.writeCommitted = true;
  fs.writeFileSync(`${filename}.tmp`, JSON.stringify(value), 'utf8');
  fs.renameSync(`${filename}.tmp`, filename);
}

module.exports = { TaskCheckpoint, fingerprint, markCheckpointWritten };
