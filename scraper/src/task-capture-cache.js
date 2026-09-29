const crypto = require('crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])])
  );
}

function captureKey(url, template, epoch = 0, matchingOptions = {}) {
  const query = new URL(url);
  query.hash = '';
  query.searchParams.sort();
  const semanticTemplate = Object.fromEntries(
    Object.entries(template).filter(
      ([key]) =>
        !/^(edge_|browser_|created_at|updated_at|template_name|template_id|id$|name$)/.test(key)
    )
  );
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          url: query.toString(),
          template: semanticTemplate,
          epoch,
          matchingOptions
        })
      )
    )
    .digest('hex');
}

function rawCaptureKey(url, template, epoch = 0) {
  const queryTemplate = { ...template };
  // These rules are applied to the complete captured room set locally.
  for (const key of ['room_type', 'room_types', 'roomTypes', 'destination'])
    delete queryTemplate[key];
  return captureKey(url, queryTemplate, epoch);
}

class TaskCaptureCache {
  constructor() {
    this.entries = new Map();
    this.hits = 0;
  }
  async getOrCollect(key, collect) {
    if (this.entries.has(key)) {
      this.hits += 1;
      return structuredClone(await this.entries.get(key));
    }
    const promise = Promise.resolve().then(collect);
    this.entries.set(key, promise);
    try {
      const value = await promise;
      if (
        !value.page_snapshot?.capture_complete ||
        value.page_snapshot?.login_required ||
        value.accessIssue
      ) {
        this.entries.delete(key);
      }
      return structuredClone(value);
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }
  clear() {
    this.entries.clear();
  }
}

module.exports = { TaskCaptureCache, captureKey, rawCaptureKey };
