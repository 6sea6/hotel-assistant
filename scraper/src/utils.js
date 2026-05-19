const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const normalized = token.slice(2);
    if (normalized.includes('=')) {
      const [key, ...parts] = normalized.split('=');
      args[key] = parts.join('=');
      continue;
    }

    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith('--')) {
      args[normalized] = true;
      continue;
    }

    args[normalized] = nextToken;
    index += 1;
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJsonFile(filePath, content, options = {}) {
  ensureDir(path.dirname(filePath));
  const pretty = options.pretty !== false;
  const space = pretty ? 2 : undefined;

  if (options.measure) {
    const stringifyStart = Date.now();
    const json = JSON.stringify(content, null, space);
    const stringifyMs = Date.now() - stringifyStart;
    const writeStart = Date.now();
    fs.writeFileSync(filePath, json, 'utf-8');
    const writeMs = Date.now() - writeStart;
    const bytes = Buffer.byteLength(json, 'utf-8');
    if (options.maxBytesWarning && bytes > options.maxBytesWarning) {
      console.warn(
        `[writeJsonFile] ${filePath} is ${(bytes / 1024).toFixed(1)}KB, exceeds ${(options.maxBytesWarning / 1024).toFixed(1)}KB warning threshold`
      );
    }
    return { bytes, stringifyMs, writeMs, totalMs: stringifyMs + writeMs };
  }

  fs.writeFileSync(filePath, JSON.stringify(content, null, space), 'utf-8');
  return null;
}

function normalizeReportLevel(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'off' ||
    normalized === 'summary' ||
    normalized === 'normal' ||
    normalized === 'full'
  ) {
    return normalized;
  }
  return 'normal';
}

const SENSITIVE_KEY_PATTERN =
  /(^|[_-]?)(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|provider[_-]?secret|token)$/i;

function sanitizeSensitiveData(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitiveData(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, sanitizeSensitiveData(entryValue)];
    })
  );
}

function removeFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}

function cleanupOutputArtifacts(outputDir, currentOutputPath, snapshotFiles = []) {
  if (!outputDir || !fs.existsSync(outputDir)) {
    return { deletedFiles: [] };
  }

  const outputRoot = path.resolve(outputDir);
  const keepFiles = new Set(
    [
      path.resolve(path.join(outputRoot, '.keep')),
      path.resolve(path.join(outputRoot, 'latest-run.json')),
      currentOutputPath ? path.resolve(currentOutputPath) : ''
    ].filter(Boolean)
  );
  const keepSnapshotFiles = new Set(
    (snapshotFiles || []).map((filePath) => path.resolve(filePath))
  );
  const deletedFiles = [];
  const keepEdgeDebugArtifacts = Boolean(
    normalizeText(process.env.HOTEL_DEBUG_EDGE_CAPTURE_DIR) ||
    normalizeText(process.env.HOTEL_DEBUG_EDGE_CAPTURE) === '1'
  );

  const rootEntries = fs.readdirSync(outputRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    const entryPath = path.join(outputRoot, entry.name);
    const resolvedEntryPath = path.resolve(entryPath);

    if (entry.isDirectory()) {
      if (entry.name !== 'raw-pages' && entry.name !== 'edge-debug') {
        continue;
      }

      const snapshotEntries = fs.readdirSync(entryPath, { withFileTypes: true });
      for (const snapshotEntry of snapshotEntries) {
        if (!snapshotEntry.isFile()) {
          continue;
        }
        const snapshotPath = path.resolve(path.join(entryPath, snapshotEntry.name));
        const shouldKeepSnapshot =
          entry.name === 'raw-pages' && keepSnapshotFiles.has(snapshotPath);
        const shouldKeepDebugArtifact = entry.name === 'edge-debug' && keepEdgeDebugArtifacts;
        if (shouldKeepSnapshot || shouldKeepDebugArtifact || snapshotEntry.name === '.keep') {
          continue;
        }
        fs.unlinkSync(snapshotPath);
        deletedFiles.push(snapshotPath);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const shouldDelete =
      /^run(?:-[^.\\/]+)?\.log$/i.test(entry.name) ||
      /^task-ping(?:-[^.\\/]+)?\.txt$/i.test(entry.name) ||
      /\.log$/i.test(entry.name) ||
      /^debug(?:-[^.\\/]+)?\.(?:txt|log)$/i.test(entry.name) ||
      /^debug-.*\.json$/i.test(entry.name) ||
      (/\.json$/i.test(entry.name) && !keepFiles.has(resolvedEntryPath));

    if (!shouldDelete || keepFiles.has(resolvedEntryPath)) {
      continue;
    }

    fs.unlinkSync(entryPath);
    deletedFiles.push(resolvedEntryPath);
  }

  return { deletedFiles };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = String(value).replace(/[,，\s]/g, '');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringNumber(value, digits = 1) {
  const parsed = toNumber(value);
  if (parsed === null) {
    return '';
  }
  return parsed
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
}

function differenceInDays(checkInDate, checkOutDate) {
  if (!checkInDate || !checkOutDate) {
    return null;
  }
  const start = new Date(`${checkInDate}T00:00:00`);
  const end = new Date(`${checkOutDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((end - start) / msPerDay);
  return diff > 0 ? diff : null;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRestrictedPostConfirmationFreeCancellation(value) {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }

  return /(?:(?:订单|预订|预定)(?:确认)?后|确认后).{0,12}?(?:\d+|[一二两三四五六七八九十百半]+)(?:个)?(?:分钟|分|小时|钟头|天|日)(?:内)?.{0,8}?(?:可)?免费取消/.test(
    text
  );
}

function normalizePlaceName(value) {
  const text = normalizeText(value)
    .replace(/[()（）]/g, ' ')
    .replace(/国家会展中心\s+上海/g, '上海国家会展中心')
    .replace(/上海\s+国家会展中心/g, '上海国家会展中心')
    .replace(/国家会展中心\s*上海/g, '上海国家会展中心');

  const citySuffixMatch = text.match(
    /^(.*?)[\s,，]+(北京|上海|天津|重庆|广州|深圳|杭州|南京|成都|武汉|西安|苏州|长沙|青岛|厦门)$/
  );
  if (citySuffixMatch) {
    return normalizeText(`${citySuffixMatch[2]}${citySuffixMatch[1]}`);
  }

  const cityParenMatch = text.match(
    /^(.*?)(北京|上海|天津|重庆|广州|深圳|杭州|南京|成都|武汉|西安|苏州|长沙|青岛|厦门)$/
  );
  if (cityParenMatch && /国家会展中心/.test(text)) {
    return normalizeText(`${cityParenMatch[2]}${cityParenMatch[1]}`);
  }

  return text;
}

function includesNormalizedPlace(left, right) {
  const normalizedLeft = normalizePlaceName(left);
  const normalizedRight = normalizePlaceName(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function extractCityName(value) {
  const text = normalizePlaceName(value);
  const cityMatch = text.match(
    /(北京|上海|天津|重庆|广州|深圳|杭州|南京|成都|武汉|西安|苏州|长沙|青岛|厦门)(?:市)?/
  );
  return cityMatch ? `${cityMatch[1]}市` : '';
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

let lastTimestampId = 0;

function createTimestampId() {
  const currentTimestamp = Date.now();
  if (currentTimestamp <= lastTimestampId) {
    lastTimestampId += 1;
    return lastTimestampId;
  }
  lastTimestampId = currentTimestamp;
  return lastTimestampId;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function extractFirstMatch(text, regex, groupIndex = 1) {
  if (!text) {
    return null;
  }
  const match = text.match(regex);
  return match ? normalizeText(match[groupIndex]) : null;
}

function compactCliResult(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const compact = {
    success: result.success,
    batchMode: result.batchMode || false,
    inputMode: result.inputMode || '',
    hotelName: result.hotelName || '',
    eligibleCount: result.eligibleCount || 0,
    totalPrice: result.totalPrice ?? null,
    outputPath: result.outputPath || '',
    latestRunPath: result.latestRunPath || '',
    error: result.error || null
  };

  if (result.batchMode) {
    compact.batchSummary = result.batchSummary
      ? {
          inputMode: result.batchSummary.inputMode,
          requestedUrlCount: result.batchSummary.requestedUrlCount,
          expandedHotelCount: result.batchSummary.expandedHotelCount,
          succeededCount: result.batchSummary.succeededCount,
          failedCount: result.batchSummary.failedCount,
          eligibleHotelRecordCount: result.batchSummary.eligibleHotelRecordCount
        }
      : null;
    compact.items = Array.isArray(result.items)
      ? result.items.slice(0, 20).map((item) => ({
          index: item.index,
          hotelName: item.hotelName,
          eligibleCount: item.eligibleCount,
          totalPrice: item.totalPrice ?? null,
          outputPath: item.outputPath || '',
          error: item.error || ''
        }))
      : [];
  }

  if (result.writeResult) {
    compact.writeResult = result.writeResult.batchMode
      ? {
          batchMode: true,
          appliedCount: result.writeResult.appliedCount,
          skippedCount: result.writeResult.skippedCount
        }
      : {
          operation: result.writeResult.operation
        };
  }

  return compact;
}

module.exports = {
  cleanupOutputArtifacts,
  compactCliResult,
  createTimestampId,
  differenceInDays,
  ensureDir,
  extractCityName,
  extractFirstMatch,
  includesNormalizedPlace,
  isRestrictedPostConfirmationFreeCancellation,
  normalizePlaceName,
  normalizeReportLevel,
  normalizeText,
  parseArgs,
  pickFirst,
  readJsonFile,
  removeFileIfExists,
  sanitizeSensitiveData,
  slugify,
  toNumber,
  toStringNumber,
  writeJsonFile
};
