const { APP_CONFIG } = require('../config');
const hotelStorage = require('../hotel-storage');
const { normalizeHotelPayload } = require('../domain/hotel-normalizer');
const { normalizeTemplatePayload } = require('../domain/template-normalizer');
const { normalizeAiProviderConfig, redactAiProviderConfig } = require('../ai/provider-presets');
const { isPlainObject } = require('../ipc-safe-handler');
const { allocateUniqueId: allocateImportedId, getIdKey } = require('../../shared/id-utils');

/**
 * services: pure data import/export transformation rules shared by data IPC handlers and tests.
 *
 * @typedef {import('../../shared/contracts').AppSettings} AppSettings
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} HotelRecord
 * @typedef {import('../../shared/contracts').TemplateInfo} TemplateInfo
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} TemplateRecord
 *
 * @typedef {{get: (key: string) => unknown, set: (key: string, value: unknown) => void}} DataTransferStore
 * @typedef {{hotels: unknown[], templates: unknown[], settings: AppSettings|Record<string, unknown>}} DataSnapshot
 * @typedef {{readCustomIconExportPayload?: (settings: AppSettings) => Record<string, unknown>|null}} ExportAppIconManager
 *
 * @typedef {object} NormalizedImportPayload
 * @property {HotelRecord[]} hotels
 * @property {TemplateRecord[]} templates
 * @property {AppSettings} settings
 * @property {Record<string, unknown>|null} customAppIcon
 * @property {Record<string, unknown>} meta
 *
 * @typedef {object} ImportStats
 * @property {number} addedHotelCount
 * @property {number} skippedHotelCount
 * @property {number} addedTemplateCount
 * @property {number} skippedTemplateCount
 *
 * @typedef {object} BuiltImportPayload
 * @property {HotelRecord[]} hotels
 * @property {TemplateRecord[]} templates
 * @property {AppSettings} settings
 * @property {ImportStats} importStats
 */

const EXPORT_SCHEMA_VERSION = 3;

/**
 * @param {unknown} settings
 * @returns {AppSettings}
 */
function normalizeImportedSettings(settings) {
  const normalizedSettings = {
    ...APP_CONFIG.STORE_DEFAULTS.settings,
    ...(isPlainObject(settings) ? settings : {})
  };
  for (const key of APP_CONFIG.DEPRECATED_SETTING_KEYS || []) {
    delete normalizedSettings[key];
  }
  normalizedSettings.ai_provider_config = normalizeAiProviderConfig(
    normalizedSettings.ai_provider_config
  );
  normalizedSettings.amapApiKey = String(normalizedSettings.amapApiKey || '').trim();
  if (normalizedSettings.amapApiKey === '[REDACTED]') {
    normalizedSettings.amapApiKey = '';
  }
  return normalizedSettings;
}

/**
 * @param {AppSettings} settings
 * @returns {AppSettings}
 */
function redactSettingsForExport(settings) {
  const exportedSettings = {
    ...settings
  };

  if (isPlainObject(exportedSettings.ai_provider_config)) {
    exportedSettings.ai_provider_config = redactAiProviderConfig(
      exportedSettings.ai_provider_config
    );
  }
  if (exportedSettings.amapApiKey) {
    exportedSettings.amapApiKey = '[REDACTED]';
  }

  return exportedSettings;
}

/**
 * @param {TemplateRecord} template
 * @returns {TemplateInfo}
 */
function buildTemplateInfoFromTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    destination: template.destination,
    check_in_date: template.check_in_date,
    check_out_date: template.check_out_date,
    room_count: template.room_count
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeComparableText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}

/**
 * @param {Partial<TemplateRecord>} template
 * @returns {string}
 */
function buildTemplateDuplicateKey(template) {
  const normalizedTemplate = normalizeTemplatePayload(template);

  return JSON.stringify([
    normalizeComparableText(normalizedTemplate.name),
    normalizeComparableText(normalizedTemplate.destination),
    normalizeComparableText(normalizedTemplate.check_in_date),
    normalizeComparableText(normalizedTemplate.check_out_date),
    normalizedTemplate.room_count ?? ''
  ]);
}

/**
 * @param {Partial<HotelRecord>} hotel
 * @returns {string}
 */
function buildHotelDuplicateKey(hotel) {
  const normalizedHotel = normalizeHotelPayload(hotel);

  return JSON.stringify([
    normalizeComparableText(normalizedHotel.name),
    normalizeComparableText(normalizedHotel.address),
    normalizeComparableText(normalizedHotel.website),
    normalizedHotel.total_price ?? '',
    normalizedHotel.daily_price ?? '',
    normalizeComparableText(normalizedHotel.check_in_date),
    normalizeComparableText(normalizedHotel.check_out_date),
    normalizedHotel.days ?? '',
    normalizeComparableText(normalizedHotel.destination),
    normalizeComparableText(normalizedHotel.room_type),
    normalizeComparableText(normalizedHotel.original_room_type),
    normalizedHotel.room_count ?? '',
    normalizeComparableText(normalizedHotel.room_area)
  ]);
}

/**
 * @param {Array<Partial<TemplateRecord>>} importedTemplates
 * @param {TemplateRecord[]} [existingTemplates]
 * @param {{skipDuplicates?: boolean, nextIdState?: {value: number}}} [options]
 * @returns {{
 *   processedTemplates: TemplateRecord[],
 *   templateByDuplicateKey: Map<string, TemplateRecord>,
 *   templateByImportedId: Map<string, TemplateRecord>,
 *   skippedCount: number
 * }}
 */
function processImportedTemplates(importedTemplates, existingTemplates = [], options = {}) {
  const skipDuplicates = Boolean(options.skipDuplicates);
  const nextIdState = options.nextIdState || { value: Date.now() };
  const usedIds = new Set(
    existingTemplates.map((template) => getIdKey(template.id)).filter((id) => id !== null)
  );
  const templateByDuplicateKey = new Map(
    existingTemplates.map((template) => [buildTemplateDuplicateKey(template), template])
  );
  const templateByImportedId = new Map();
  const processedTemplates = [];
  let skippedCount = 0;

  for (const template of importedTemplates) {
    const normalizedTemplate = normalizeTemplatePayload(template);
    const originalIdKey = getIdKey(normalizedTemplate.id);
    const duplicateKey = buildTemplateDuplicateKey(normalizedTemplate);

    if (skipDuplicates && templateByDuplicateKey.has(duplicateKey)) {
      const matchedTemplate = templateByDuplicateKey.get(duplicateKey);
      if (originalIdKey) {
        templateByImportedId.set(originalIdKey, matchedTemplate);
      }
      skippedCount += 1;
      continue;
    }

    const finalTemplateId = allocateImportedId(normalizedTemplate.id, usedIds, nextIdState);
    const finalTemplate = normalizeTemplatePayload(
      {
        ...normalizedTemplate,
        id: finalTemplateId
      },
      normalizedTemplate
    );

    processedTemplates.push(finalTemplate);
    templateByDuplicateKey.set(duplicateKey, finalTemplate);
    if (originalIdKey) {
      templateByImportedId.set(originalIdKey, finalTemplate);
    }
  }

  return {
    processedTemplates,
    templateByDuplicateKey,
    templateByImportedId,
    skippedCount
  };
}

/**
 * @param {HotelRecord} normalizedHotel
 * @param {Map<string, TemplateRecord>} templateByImportedId
 * @param {Map<string, TemplateRecord>} templateByDuplicateKey
 * @returns {{template_id: import('../../shared/contracts').EntityId|null|undefined, template_info: TemplateInfo|null|undefined}}
 */
function resolveImportedHotelTemplate(
  normalizedHotel,
  templateByImportedId,
  templateByDuplicateKey
) {
  const linkedTemplateIdKey =
    getIdKey(normalizedHotel.template_id) || getIdKey(normalizedHotel.template_info?.id);
  let matchedTemplate = linkedTemplateIdKey ? templateByImportedId.get(linkedTemplateIdKey) : null;

  if (!matchedTemplate && normalizedHotel.template_info) {
    matchedTemplate = templateByDuplicateKey.get(
      buildTemplateDuplicateKey(normalizedHotel.template_info)
    );
  }

  if (!matchedTemplate) {
    return {
      template_id: normalizedHotel.template_id,
      template_info: normalizedHotel.template_info
    };
  }

  return {
    template_id: matchedTemplate.id,
    template_info: buildTemplateInfoFromTemplate(matchedTemplate)
  };
}

/**
 * @param {Array<Partial<HotelRecord>>} importedHotels
 * @param {HotelRecord[]} [existingHotels]
 * @param {{
 *   skipDuplicates?: boolean,
 *   nextIdState?: {value: number},
 *   templateByImportedId?: Map<string, TemplateRecord>,
 *   templateByDuplicateKey?: Map<string, TemplateRecord>
 * }} [options]
 * @returns {{processedHotels: HotelRecord[], skippedCount: number}}
 */
function processImportedHotels(importedHotels, existingHotels = [], options = {}) {
  const skipDuplicates = Boolean(options.skipDuplicates);
  const nextIdState = options.nextIdState || { value: Date.now() };
  const templateByImportedId = options.templateByImportedId || new Map();
  const templateByDuplicateKey = options.templateByDuplicateKey || new Map();
  const usedIds = new Set(
    existingHotels.map((hotel) => getIdKey(hotel.id)).filter((id) => id !== null)
  );
  const hotelDuplicateKeys = new Set(
    skipDuplicates ? existingHotels.map((hotel) => buildHotelDuplicateKey(hotel)) : []
  );
  const processedHotels = [];
  let skippedCount = 0;

  for (const hotel of importedHotels) {
    const normalizedHotel = normalizeHotelPayload(hotel);
    const resolvedTemplate = resolveImportedHotelTemplate(
      normalizedHotel,
      templateByImportedId,
      templateByDuplicateKey
    );
    const candidateHotel = normalizeHotelPayload({
      ...normalizedHotel,
      template_id: resolvedTemplate.template_id,
      template_info: resolvedTemplate.template_info
    });
    const duplicateKey = buildHotelDuplicateKey(candidateHotel);

    if (skipDuplicates && hotelDuplicateKeys.has(duplicateKey)) {
      skippedCount += 1;
      continue;
    }

    const finalHotelId = allocateImportedId(candidateHotel.id, usedIds, nextIdState);
    const finalHotel = normalizeHotelPayload(
      {
        ...candidateHotel,
        id: finalHotelId
      },
      candidateHotel
    );

    processedHotels.push(finalHotel);
    if (skipDuplicates) {
      hotelDuplicateKeys.add(duplicateKey);
    }
  }

  return {
    processedHotels,
    skippedCount
  };
}

/**
 * @param {DataTransferStore} store
 * @param {{appIconManager?: ExportAppIconManager}} [options]
 * @returns {{
 *   hotels: unknown[],
 *   templates: TemplateRecord[],
 *   settings: AppSettings,
 *   exportedAt: string,
 *   appVersion: string,
 *   schemaVersion: number,
 *   meta: Record<string, unknown>
 * }}
 */
function buildExportPayload(store, options = {}) {
  const exportedAt = new Date().toISOString();
  const hotels = hotelStorage.compactHotels(
    hotelStorage.getExpandedHotelsFromStore(store, normalizeHotelPayload),
    normalizeHotelPayload
  );
  const templates = /** @type {Array<Partial<TemplateRecord>>} */ (
    store.get('templates') || []
  ).map((template) => normalizeTemplatePayload(template));
  const settings = normalizeImportedSettings(store.get('settings'));
  const exportedSettings = redactSettingsForExport(settings);
  const customAppIcon =
    typeof options.appIconManager?.readCustomIconExportPayload === 'function'
      ? options.appIconManager.readCustomIconExportPayload(settings)
      : null;

  return {
    hotels,
    templates,
    settings: exportedSettings,
    exportedAt,
    appVersion: APP_CONFIG.VERSION,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    meta: {
      sourceApp: APP_CONFIG.NAME,
      appVersion: APP_CONFIG.VERSION,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt,
      customAppIcon
    }
  };
}

// 导入来源约定为本应用自己导出的 JSON，因此这里重点做两件事：
// 1. 兼容旧版本导出的字段与 ID 类型；2. 任一环节失败时恢复导入前快照，避免半写入状态。
/**
 * @param {unknown} rawPayload
 * @returns {NormalizedImportPayload}
 */
function normalizeImportedPayload(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    throw new Error('导入文件格式不正确');
  }

  // 基本来源校验：必须包含 hotels 数组或 meta.sourceApp 标识
  const meta = isPlainObject(rawPayload.meta) ? rawPayload.meta : null;
  const rawHotels = Array.isArray(rawPayload.hotels) ? rawPayload.hotels : null;
  const rawTemplates = Array.isArray(rawPayload.templates) ? rawPayload.templates : null;
  const hasHotelsArray = Boolean(rawHotels);
  const isKnownSource = meta && meta.sourceApp === APP_CONFIG.NAME;

  if (!hasHotelsArray && !isKnownSource) {
    throw new Error('无法识别导入文件，请确认是否为本应用导出的数据');
  }

  // hotels 内部结构校验
  let normalizedHotels = [];
  if (rawHotels) {
    for (let i = 0; i < rawHotels.length; i++) {
      const h = rawHotels[i];
      if (!isPlainObject(h)) {
        throw new Error(`hotels[${i}] 不是有效的对象`);
      }

      if (isPlainObject(h.shared) || Array.isArray(h.rooms)) {
        if (!isPlainObject(h.shared)) {
          throw new Error(`hotels[${i}].shared 不是有效的对象`);
        }
        if (!Array.isArray(h.rooms)) {
          throw new Error(`hotels[${i}].rooms 不是有效的数组`);
        }
        for (let roomIndex = 0; roomIndex < h.rooms.length; roomIndex++) {
          if (!isPlainObject(h.rooms[roomIndex])) {
            throw new Error(`hotels[${i}].rooms[${roomIndex}] 不是有效的对象`);
          }
        }
      }
    }

    normalizedHotels = hotelStorage.expandStoredHotels(rawHotels, normalizeHotelPayload);

    for (let i = 0; i < normalizedHotels.length; i++) {
      const h = normalizedHotels[i];
      if (!h.name || typeof h.name !== 'string' || !h.name.trim()) {
        throw new Error(`hotels[${i}] 缺少必填字段 name`);
      }
    }
  }

  // templates 内部结构校验
  if (rawTemplates) {
    for (let i = 0; i < rawTemplates.length; i++) {
      const t = rawTemplates[i];
      if (!isPlainObject(t)) {
        throw new Error(`templates[${i}] 不是有效的对象`);
      }
      if (!t.name || typeof t.name !== 'string' || !t.name.trim()) {
        throw new Error(`templates[${i}] 缺少必填字段 name`);
      }
    }
  }

  return {
    hotels: normalizedHotels,
    templates: rawTemplates
      ? rawTemplates.map((template) => normalizeTemplatePayload(template))
      : [],
    settings: normalizeImportedSettings(rawPayload.settings),
    customAppIcon: meta && isPlainObject(meta.customAppIcon) ? meta.customAppIcon : null,
    meta: meta
      ? meta
      : {
          sourceApp: rawPayload.sourceApp || APP_CONFIG.NAME,
          appVersion: rawPayload.appVersion || 'legacy',
          schemaVersion: rawPayload.schemaVersion || 1,
          exportedAt: rawPayload.exportedAt || null
        }
  };
}

/**
 * @param {DataTransferStore} store
 * @param {DataSnapshot} snapshot
 * @returns {void}
 */
function restoreSnapshot(store, snapshot) {
  store.set('hotels', snapshot.hotels);
  store.set('templates', snapshot.templates);
  store.set('settings', snapshot.settings);
}

/**
 * @param {{hotels: HotelRecord[], templates: TemplateRecord[], settings: AppSettings}} importedPayload
 * @returns {BuiltImportPayload}
 */
function buildReplaceImportPayload(importedPayload) {
  const nextIdState = { value: Date.now() };
  const templateProcessingResult = processImportedTemplates(importedPayload.templates, [], {
    skipDuplicates: false,
    nextIdState
  });
  const hotelProcessingResult = processImportedHotels(importedPayload.hotels, [], {
    skipDuplicates: false,
    nextIdState,
    templateByImportedId: templateProcessingResult.templateByImportedId,
    templateByDuplicateKey: templateProcessingResult.templateByDuplicateKey
  });

  return {
    hotels: hotelProcessingResult.processedHotels,
    templates: templateProcessingResult.processedTemplates,
    settings: normalizeImportedSettings(importedPayload.settings),
    importStats: {
      addedHotelCount: hotelProcessingResult.processedHotels.length,
      skippedHotelCount: 0,
      addedTemplateCount: templateProcessingResult.processedTemplates.length,
      skippedTemplateCount: 0
    }
  };
}

/**
 * @param {DataSnapshot} snapshot
 * @param {{hotels: HotelRecord[], templates: TemplateRecord[], settings: AppSettings}} importedPayload
 * @returns {BuiltImportPayload}
 */
function buildAppendImportPayload(snapshot, importedPayload) {
  const existingHotels = hotelStorage.expandStoredHotels(
    snapshot.hotels || [],
    normalizeHotelPayload
  );
  const existingTemplates = /** @type {Array<Partial<TemplateRecord>>} */ (
    snapshot.templates || []
  ).map((template) => normalizeTemplatePayload(template));
  const nextIdState = { value: Date.now() };
  const templateProcessingResult = processImportedTemplates(
    importedPayload.templates,
    existingTemplates,
    {
      skipDuplicates: true,
      nextIdState
    }
  );
  const hotelProcessingResult = processImportedHotels(importedPayload.hotels, existingHotels, {
    skipDuplicates: true,
    nextIdState,
    templateByImportedId: templateProcessingResult.templateByImportedId,
    templateByDuplicateKey: templateProcessingResult.templateByDuplicateKey
  });

  return {
    hotels: [...existingHotels, ...hotelProcessingResult.processedHotels],
    templates: [...existingTemplates, ...templateProcessingResult.processedTemplates],
    settings: normalizeImportedSettings(snapshot.settings),
    importStats: {
      addedHotelCount: hotelProcessingResult.processedHotels.length,
      skippedHotelCount: hotelProcessingResult.skippedCount,
      addedTemplateCount: templateProcessingResult.processedTemplates.length,
      skippedTemplateCount: templateProcessingResult.skippedCount
    }
  };
}

module.exports = {
  EXPORT_SCHEMA_VERSION,
  buildAppendImportPayload,
  buildExportPayload,
  buildHotelDuplicateKey,
  buildReplaceImportPayload,
  buildTemplateDuplicateKey,
  buildTemplateInfoFromTemplate,
  normalizeComparableText,
  normalizeImportedPayload,
  normalizeImportedSettings,
  processImportedHotels,
  processImportedTemplates,
  redactSettingsForExport,
  resolveImportedHotelTemplate,
  restoreSnapshot
};
