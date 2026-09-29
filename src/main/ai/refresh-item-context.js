const path = require('path');
const { assertNotCancelled, buildScraperArgs } = require('./scraper-task-input');
const { getVisibleLoginRetryNeed } = require('./ctrip-login-retry');

const PRESERVED_FIELDS_ON_REFRESH = [
  'distance',
  'subway_station',
  'subway_distance',
  'transport_time',
  'bus_route',
  'destination',
  'template_id',
  'is_favorite',
  'notes'
];

const STALE_REFRESH_NOTE_PATTERNS = [
  /更新时未获取到有效房价/,
  /已清空旧的可疑统一低价/,
  /页面未提取到明确房价/,
  /可能需要登录、验证码/,
  /携程房型接口触发反爬限制/
];

function countUniqueRoomTypes(hotels = []) {
  const roomTypes = new Set(
    (Array.isArray(hotels) ? hotels : [])
      .map((hotel) => String((hotel && (hotel.room_type || hotel.original_room_type)) || '').trim())
      .filter(Boolean)
  );
  return roomTypes.size || (Array.isArray(hotels) ? hotels.filter(Boolean).length : 0);
}

function hasSpiderRiskSignal(pageSnapshot = {}) {
  const spiderCodes = Array.isArray(pageSnapshot.spider_error_codes)
    ? pageSnapshot.spider_error_codes
    : [];
  if (spiderCodes.length > 0) {
    return true;
  }

  return (Array.isArray(pageSnapshot.sources) ? pageSnapshot.sources : []).some((source) => {
    if (!source || typeof source !== 'object') {
      return false;
    }
    const sourceCodes = Array.isArray(source.spider_error_codes) ? source.spider_error_codes : [];
    return sourceCodes.length > 0;
  });
}

function getBookingUnavailableSignal(collectResult = {}) {
  const pageSnapshot = collectResult && (collectResult.pageSnapshot || collectResult.page_snapshot);
  if (!pageSnapshot || typeof pageSnapshot !== 'object' || !pageSnapshot.booking_unavailable) {
    return {
      detected: false,
      reason: ''
    };
  }

  return {
    detected: true,
    reason: pageSnapshot.booking_unavailable_reason || '当前日期不可预订'
  };
}

function shouldClearExistingHotelsForUnavailableRefresh(collectResult = {}, retryNeed = {}) {
  if (!collectResult || collectResult.success !== true || retryNeed.needed) {
    return false;
  }

  const eligibleCount = Number(collectResult.eligibleCount);
  if (!Number.isFinite(eligibleCount) || eligibleCount > 0) {
    return false;
  }

  // 页面层（HTML/Edge DOM）确定性"不可预订"信号优先：直接清空，不被风控否决。
  // 但需双保险约束：仅当确实无可见价格（room_price_visible=false）时才清空。
  // 否则像 hotelId=441585 这种"有可见价格的榻榻米房型 + i18n 字典误判不可预订"
  // 的酒店会被误删。真实"不接受预订"的酒店（如 hotelId=895608）页面无任何可见价格，
  // room_price_visible=false，仍会正确清空。
  const pageSnapshot = collectResult.pageSnapshot || collectResult.page_snapshot || {};
  if (collectResult.accessIssue || pageSnapshot.login_required || hasSpiderRiskSignal(pageSnapshot))
    return false;
  const hasVisiblePrice = Boolean(pageSnapshot.room_price_visible);
  if (!hasVisiblePrice && getBookingUnavailableSignal(collectResult).detected) {
    return true;
  }

  if (pageSnapshot.login_required || hasSpiderRiskSignal(pageSnapshot)) {
    return false;
  }

  return false;
}

function buildUnavailableRefreshClearResult({ hotelName, url, existingHotels, reason }) {
  return {
    hotelName,
    url,
    status: 'cleared',
    updatedHotels: [],
    updatedRoomTypeCount: 0,
    deletedRoomTypeCount: countUniqueRoomTypes(existingHotels),
    skipReason: '',
    error: '',
    retryAfterLogin: false,
    deleteExistingGroup: true,
    existingHotels,
    clearReason: reason || '当前日期不可预订'
  };
}

function isStaleRefreshFailureNote(value) {
  const text = String(value || '').trim();
  return Boolean(text) && STALE_REFRESH_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

function createRefreshItemEventEmitter({ emit, index, total, hotelName }) {
  return (eventType, message, details = {}) => {
    const type = eventType || '';
    if (
      type.startsWith('transit:') ||
      type === 'transit:start' ||
      type === 'transit:done' ||
      type === 'task:start' ||
      type === 'task:done'
    ) {
      return;
    }
    emit(type, message, {
      index,
      total,
      hotelName,
      ...details
    });
  };
}

function buildRefreshCollectArgs({
  url,
  firstHotel = {},
  input = {},
  workDir,
  worker = null,
  baseEdgeUserDataDir = '',
  baseEdgeProfileDirectory = 'Default'
}) {
  const collectArgs = buildScraperArgs(
    {
      url,
      templateId: firstHotel.template_id || '',
      templateName: '',
      amapKey: input.amapKey,
      collectBrowser: input.collectBrowser
    },
    workDir
  );
  collectArgs.skipTransit = true;
  collectArgs['skip-report'] = true;
  collectArgs['no-output-report'] = true;
  collectArgs.captureStrategy = 'browser_first';
  if (worker && worker.port) {
    collectArgs['auto-edge'] = false;
    collectArgs['edge-user-data-dir'] = worker.userDataDir || baseEdgeUserDataDir;
    collectArgs['edge-profile-directory'] = worker.profileDirectory || baseEdgeProfileDirectory;
    collectArgs['edge-debugging-port'] = Number(worker.port);
  }
  return collectArgs;
}

function createRefreshDetailContextFactory({
  accessController = null,
  captureCache = null,
  checkpoint = null,
  metrics = null,
  input = {},
  taskContext = {},
  workDir,
  hotelGroups,
  bridge,
  store,
  compareAppSettings = {},
  baseEdgeUserDataDir = '',
  baseEdgeProfileDirectory = 'Default',
  emit,
  createScrapeEventForwarder,
  applyMatchedTemplate,
  mergeTemplateWithArgs,
  validateTemplate,
  normalizePlaceName
}) {
  return async function createRefreshDetailContext({ url, index, total, hotelName, worker }) {
    assertNotCancelled(taskContext.signal);
    const existingHotels = hotelGroups.get(url) || [];
    const firstHotel = existingHotels[0] || {};
    const collectArgs = buildRefreshCollectArgs({
      url,
      firstHotel,
      input,
      workDir,
      worker,
      baseEdgeUserDataDir,
      baseEdgeProfileDirectory
    });
    const itemEmit = createRefreshItemEventEmitter({ emit, index, total, hotelName });
    const loadedTemplate = mergeTemplateWithArgs({}, collectArgs);
    const matchedTemplate = bridge.findTemplateInStore(
      store,
      loadedTemplate.template_id,
      loadedTemplate.template_name || collectArgs.templateName
    );
    const currentEffectiveTemplate = applyMatchedTemplate(loadedTemplate, matchedTemplate);
    const historicalTemplateInfo =
      firstHotel.template_info && typeof firstHotel.template_info === 'object'
        ? firstHotel.template_info
        : {};
    const historicalRoomCount = Number(
      historicalTemplateInfo.room_count ||
        firstHotel.room_count ||
        currentEffectiveTemplate.room_count
    );
    const effectiveTemplate = {
      ...currentEffectiveTemplate,
      check_in_date:
        firstHotel.check_in_date ||
        historicalTemplateInfo.check_in_date ||
        currentEffectiveTemplate.check_in_date,
      check_out_date:
        firstHotel.check_out_date ||
        historicalTemplateInfo.check_out_date ||
        currentEffectiveTemplate.check_out_date,
      days: Number(firstHotel.days || currentEffectiveTemplate.days) || undefined,
      room_count:
        Number.isFinite(historicalRoomCount) && historicalRoomCount > 0
          ? historicalRoomCount
          : currentEffectiveTemplate.room_count,
      room_type: '',
      destination:
        firstHotel.destination ||
        historicalTemplateInfo.destination ||
        currentEffectiveTemplate.destination
    };
    const refreshMatchedTemplate = matchedTemplate
      ? {
          ...matchedTemplate,
          check_in_date: effectiveTemplate.check_in_date,
          check_out_date: effectiveTemplate.check_out_date,
          room_count: effectiveTemplate.room_count,
          destination: effectiveTemplate.destination
        }
      : matchedTemplate;
    validateTemplate(effectiveTemplate);
    const effectiveDestination = normalizePlaceName(effectiveTemplate.destination);

    return {
      context: {
        accessController,
        captureCache,
        checkpoint,
        metrics,
        isBatchItem: true,
        args: collectArgs,
        startedAt: new Date().toISOString(),
        taskId: `${taskContext.taskId || 'refresh'}-${index}`,
        emit: itemEmit,
        signal: taskContext.signal,
        outputDir: path.join(workDir, 'output'),
        template: loadedTemplate,
        matchedTemplate: refreshMatchedTemplate,
        effectiveTemplate,
        compareAppSettings,
        effectiveDestination,
        hotelInput: {
          url,
          requestedUrl: url,
          source: 'refresh',
          hotelId: firstHotel.id || ''
        },
        outputPath: '',
        autoEdge: false,
        transitCache: null,
        writeAppData: false,
        pageIndex: index,
        reportLevel: 'off',
        captureStrategy: collectArgs.captureStrategy,
        edgeParallelCancelPolicy: collectArgs.edgeParallelCancelPolicy || 'none',
        scrapeEventForwarder: createScrapeEventForwarder(itemEmit)
      },
      meta: {
        refreshItem: {
          existingHotels,
          firstHotel
        }
      }
    };
  };
}

function getRefreshItemMeta(meta = {}) {
  return meta && meta.refreshItem ? meta.refreshItem : meta;
}

function preserveRefreshFields(newHotel, oldHotel = {}) {
  const preserved = {};
  for (const field of PRESERVED_FIELDS_ON_REFRESH) {
    if (field === 'notes') {
      continue;
    }
    if (oldHotel[field] !== undefined && oldHotel[field] !== null && oldHotel[field] !== '') {
      preserved[field] = oldHotel[field];
    }
  }
  if (oldHotel.is_favorite !== undefined) {
    preserved.is_favorite = oldHotel.is_favorite;
  }
  if (oldHotel.notes !== undefined && !isStaleRefreshFailureNote(oldHotel.notes)) {
    preserved.notes = oldHotel.notes;
  }
  return {
    ...newHotel,
    ...preserved
  };
}

async function mapRefreshPreparedResult({ preparedResult, url, hotelName, meta }) {
  const refreshItem = getRefreshItemMeta(meta);
  const existingHotels = refreshItem.existingHotels || [];
  const firstHotel = refreshItem.firstHotel || existingHotels[0] || {};
  const collectResult = preparedResult.result;
  if (collectResult?.resumedFromCheckpoint)
    return {
      hotelName,
      url,
      status: 'resumed',
      collectedAt: collectResult.collectedAt,
      updatedHotels: [],
      skipReason: '沿用原采集时间，已完成项目无需再次写入'
    };
  if (collectResult?.accessIssue || collectResult?.pageSnapshot?.capture_complete === false) {
    return {
      hotelName,
      url,
      status: 'skipped',
      updatedHotels: [],
      skipReason: '采集结果不完整或访问受限，保留已有价格'
    };
  }

  if (
    !collectResult ||
    collectResult.success !== true ||
    !Number.isFinite(Number(collectResult.eligibleCount)) ||
    Number(collectResult.eligibleCount) <= 0
  ) {
    const retryNeed = getVisibleLoginRetryNeed(collectResult);
    if (shouldClearExistingHotelsForUnavailableRefresh(collectResult, retryNeed)) {
      const unavailable = getBookingUnavailableSignal(collectResult);
      return buildUnavailableRefreshClearResult({
        hotelName,
        url,
        existingHotels,
        reason: unavailable.reason
      });
    }
    const skipReason =
      retryNeed.needed && retryNeed.reason
        ? retryNeed.reason
        : collectResult && collectResult.error
          ? collectResult.error
          : '采集未返回有效房型数据';
    return {
      hotelName,
      url,
      status: 'skipped',
      updatedHotels: [],
      updatedRoomTypeCount: 0,
      deletedRoomTypeCount: 0,
      skipReason,
      error: skipReason,
      retryAfterLogin: Boolean(retryNeed.needed)
    };
  }

  const newHotels = Array.isArray(collectResult.eligibleHotels) ? collectResult.eligibleHotels : [];
  if (newHotels.length === 0) {
    return {
      hotelName,
      url,
      status: 'skipped',
      updatedHotels: [],
      updatedRoomTypeCount: 0,
      deletedRoomTypeCount: 0,
      skipReason: '采集成功但没有有效房型',
      error: '',
      retryAfterLogin: false
    };
  }

  const buildRoomIdentity = (hotel = {}) => {
    const roomType = String(hotel.room_type || '').trim();
    const originalRoomType = String(hotel.original_room_type || roomType).trim();
    if (!roomType && !originalRoomType) return '';
    return `${roomType}\u0000${originalRoomType}`;
  };
  const oldRoomIdentities = new Set(existingHotels.map(buildRoomIdentity).filter(Boolean));
  const preservedByExactRoom = new Map();
  const preservedByRoomType = new Map();
  for (const oldHotel of existingHotels) {
    const roomType = (oldHotel.room_type || '').trim();
    const originalRoomType = (oldHotel.original_room_type || '').trim();
    if (roomType || originalRoomType) {
      preservedByExactRoom.set(`${roomType}\u0000${originalRoomType}`, oldHotel);
    }
    if (!preservedByRoomType.has(roomType)) {
      preservedByRoomType.set(roomType, oldHotel);
    }
  }

  const refreshedHotels = newHotels.map((newHotel) => {
    const roomType = (newHotel.room_type || '').trim();
    const originalRoomType = (newHotel.original_room_type || '').trim();
    const oldHotel =
      preservedByExactRoom.get(`${roomType}\u0000${originalRoomType}`) ||
      preservedByRoomType.get(roomType) ||
      firstHotel;
    return preserveRefreshFields(newHotel, oldHotel);
  });

  const refreshedRoomIdentities = new Set(refreshedHotels.map(buildRoomIdentity).filter(Boolean));
  const observedRoomIdentities = new Set(
    (Array.isArray(collectResult.observedRooms) ? collectResult.observedRooms : [])
      .map(buildRoomIdentity)
      .filter(Boolean)
  );
  const retainedUnavailablePriceHotels = existingHotels.filter((hotel) => {
    const identity = buildRoomIdentity(hotel);
    return observedRoomIdentities.has(identity) && !refreshedRoomIdentities.has(identity);
  });
  refreshedHotels.push(...retainedUnavailablePriceHotels);
  retainedUnavailablePriceHotels.forEach((hotel) =>
    refreshedRoomIdentities.add(buildRoomIdentity(hotel))
  );
  let deletedForThisHotel = 0;
  for (const oldIdentity of oldRoomIdentities) {
    if (!refreshedRoomIdentities.has(oldIdentity)) {
      deletedForThisHotel++;
    }
  }

  return {
    hotelName,
    url,
    status: 'updated',
    updatedHotels: refreshedHotels,
    updatedRoomTypeCount: newHotels.length,
    retainedRoomTypeCount: retainedUnavailablePriceHotels.length,
    deletedRoomTypeCount: deletedForThisHotel,
    skipReason: '',
    error: '',
    retryAfterLogin: false
  };
}

module.exports = {
  PRESERVED_FIELDS_ON_REFRESH,
  buildRefreshCollectArgs,
  countUniqueRoomTypes,
  createRefreshDetailContextFactory,
  createRefreshItemEventEmitter,
  getBookingUnavailableSignal,
  isStaleRefreshFailureNote,
  mapRefreshPreparedResult,
  preserveRefreshFields,
  shouldClearExistingHotelsForUnavailableRefresh
};
