const path = require('path');
const { assertNotCancelled, buildScraperArgs } = require('./scraper-task-input');

const PRESERVED_FIELDS_ON_REFRESH = [
  'distance',
  'subway_station',
  'subway_distance',
  'transport_time',
  'bus_route',
  'destination',
  'template_id',
  'template_info',
  'check_in_date',
  'check_out_date',
  'days',
  'is_favorite',
  'notes'
];

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
  collectArgs.captureStrategy = 'parallel_edge';
  if (worker && worker.port) {
    collectArgs['auto-edge'] = false;
    collectArgs['edge-user-data-dir'] = worker.userDataDir || baseEdgeUserDataDir;
    collectArgs['edge-profile-directory'] =
      worker.profileDirectory || baseEdgeProfileDirectory;
    collectArgs['edge-debugging-port'] = Number(worker.port);
  }
  return collectArgs;
}

function createRefreshDetailContextFactory({
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
    const effectiveTemplate = applyMatchedTemplate(loadedTemplate, matchedTemplate);
    validateTemplate(effectiveTemplate);
    const effectiveDestination = normalizePlaceName(
      (matchedTemplate && matchedTemplate.destination) || effectiveTemplate.destination
    );

    return {
      context: {
        args: collectArgs,
        startedAt: new Date().toISOString(),
        taskId: `${taskContext.taskId || 'refresh'}-${index}`,
        emit: itemEmit,
        signal: taskContext.signal,
        outputDir: path.join(workDir, 'output'),
        template: loadedTemplate,
        matchedTemplate,
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
    if (oldHotel[field] !== undefined && oldHotel[field] !== null && oldHotel[field] !== '') {
      preserved[field] = oldHotel[field];
    }
  }
  if (oldHotel.is_favorite !== undefined) {
    preserved.is_favorite = oldHotel.is_favorite;
  }
  if (oldHotel.notes !== undefined) {
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

  if (
    !collectResult ||
    collectResult.success !== true ||
    !Number.isFinite(Number(collectResult.eligibleCount)) ||
    Number(collectResult.eligibleCount) <= 0
  ) {
    const skipReason =
      collectResult && collectResult.error ? collectResult.error : '采集未返回有效房型数据';
    return {
      hotelName,
      url,
      status: 'skipped',
      updatedHotels: [],
      updatedRoomTypeCount: 0,
      deletedRoomTypeCount: 0,
      skipReason,
      error: skipReason
    };
  }

  const newHotels = Array.isArray(collectResult.eligibleHotels)
    ? collectResult.eligibleHotels
    : [];
  if (newHotels.length === 0) {
    return {
      hotelName,
      url,
      status: 'skipped',
      updatedHotels: [],
      updatedRoomTypeCount: 0,
      deletedRoomTypeCount: 0,
      skipReason: '采集成功但没有有效房型',
      error: ''
    };
  }

  const oldRoomTypes = new Set(
    existingHotels.map((hotel) => (hotel.room_type || '').trim()).filter(Boolean)
  );
  const preservedByRoomType = new Map();
  for (const oldHotel of existingHotels) {
    const roomType = (oldHotel.room_type || '').trim();
    preservedByRoomType.set(roomType, oldHotel);
  }

  const refreshedHotels = newHotels.map((newHotel) => {
    const oldHotel = preservedByRoomType.get((newHotel.room_type || '').trim()) || firstHotel;
    return preserveRefreshFields(newHotel, oldHotel);
  });

  const newRoomTypes = new Set(
    refreshedHotels.map((hotel) => (hotel.room_type || '').trim()).filter(Boolean)
  );
  let deletedForThisHotel = 0;
  for (const oldType of oldRoomTypes) {
    if (!newRoomTypes.has(oldType)) {
      deletedForThisHotel++;
    }
  }

  return {
    hotelName,
    url,
    status: 'updated',
    updatedHotels: refreshedHotels,
    updatedRoomTypeCount: refreshedHotels.length,
    deletedRoomTypeCount: deletedForThisHotel,
    skipReason: '',
    error: ''
  };
}

module.exports = {
  PRESERVED_FIELDS_ON_REFRESH,
  buildRefreshCollectArgs,
  createRefreshDetailContextFactory,
  createRefreshItemEventEmitter,
  mapRefreshPreparedResult,
  preserveRefreshFields
};
