const path = require('path');
const { requireSharedCompareAppModule } = require('./compare-app/shared-module');
const { BASE_COMPARE_APP_SETTINGS } = requireSharedCompareAppModule('constants.js');
const { DEFAULT_AMAP_KEY } = require('./constants');
const {
  appendHotelsToStore,
  findTemplateInStore,
  getCompareAppStorePath,
  loadCompareAppStore
} = require('./compare-app-bridge');
const { scrapeCtripHotel } = require('./ctrip-scraper');
const {
  describeExpandedInput,
  expandCtripHotelInputs,
  normalizeListFiltersFromArgs
} = require('./ctrip-list');
const {
  closeAutoEdge,
  hasReusableEdgeProfile,
  launchAndWaitForEdge,
  runInteractiveEdgeLoginPrep
} = require('./cli/auto-edge');
const { applyReviewedOutput } = require('./cli/reviewed-output');
const {
  DEFAULT_LATEST_RUN_PATH,
  buildPageSnapshotSummary,
  buildRunSummary,
  writeLatestRunFile
} = require('./cli/run-summary');
const { shouldSkipHotelWrite } = require('./cli/write-policy');
const { getTransitInfo } = require('./amap');
const { buildHotelRecord, buildEligibleRoomRecords } = require('./hotel-record');
const { buildReviewInput } = require('./review-input');
const {
  applyMatchedTemplate,
  loadTemplate,
  mergeTemplateWithArgs,
  validateTemplate
} = require('./template-loader');
const {
  cleanupOutputArtifacts,
  ensureDir,
  normalizePlaceName,
  parseArgs,
  sanitizeSensitiveData,
  slugify,
  writeJsonFile
} = require('./utils');
const { setup_perf_logger, PerfTimer, BatchStats } = require('./runtime/perf');

function buildTemplateSnapshot(template, source = '') {
  if (!template || typeof template !== 'object') {
    return null;
  }

  return {
    source,
    id: template.id ?? template.template_id ?? null,
    name: template.name || template.template_name || '',
    destination: template.destination || '',
    check_in_date: template.check_in_date || '',
    check_out_date: template.check_out_date || '',
    room_count: template.room_count ?? null,
    created_at: template.created_at || null
  };
}

function normalizeTaskArgs(args = {}) {
  if (Array.isArray(args)) {
    return parseArgs(args);
  }

  return {
    ...args
  };
}

function assertNotCancelled(signal) {
  if (signal && signal.aborted) {
    throw new Error('任务已取消');
  }
}

async function withWorkingDirectory(workingDirectory, task) {
  const normalizedWorkingDirectory = workingDirectory ? path.resolve(workingDirectory) : '';
  if (!normalizedWorkingDirectory) {
    return task();
  }

  const previousCwd = process.cwd();
  process.chdir(normalizedWorkingDirectory);
  try {
    return await task();
  } finally {
    process.chdir(previousCwd);
  }
}

function createTaskEmitter(onEvent) {
  return (type, message, details = {}) => {
    if (typeof onEvent !== 'function') {
      return;
    }

    onEvent({
      type,
      message,
      details,
      at: new Date().toISOString()
    });
  };
}

function buildFailureResult(error, latestRunPath, startedAt) {
  const failedAt = new Date().toISOString();
  return {
    success: false,
    startedAt,
    finishedAt: failedAt,
    latestRunPath,
    error: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : ''
  };
}

function writeFailureSummary(error, latestRunPath, startedAt) {
  const result = buildFailureResult(error, latestRunPath, startedAt);
  writeLatestRunFile(latestRunPath, buildRunSummary(result));
  return result;
}

function buildEdgeSessionOptions(effectiveTemplate = {}) {
  return {
    userDataDir: effectiveTemplate.edge_user_data_dir,
    profileDirectory: effectiveTemplate.edge_profile_directory,
    debuggerUrl: effectiveTemplate.edge_debugger_url,
    debuggingPort: effectiveTemplate.edge_debugging_port,
    headless: effectiveTemplate.edge_headless
  };
}

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function createTransitCache() {
  return {
    geocode: new Map(),
    places: new Map(),
    nearestSubway: new Map(),
    walkingRoutes: new Map(),
    transitRoutes: new Map()
  };
}

function buildBatchItems(childResults = [], failedItems = []) {
  const items = [
    ...childResults.map((result, index) => ({
      index: result.inputIndex || index + 1,
      success: result.success === true,
      url: result.resolvedUrl || result.requestedUrl || '',
      requestedUrl: result.requestedUrl || '',
      resolvedUrl: result.resolvedUrl || '',
      source: result.inputSource || '',
      hotelId: result.hotelId || '',
      hotelName: result.hotelName || '',
      eligibleCount: result.eligibleCount || 0,
      eligibleRoomTypes: Array.isArray(result.eligibleRoomTypes) ? result.eligibleRoomTypes : [],
      totalPrice: result.totalPrice ?? null,
      roomPrices: Array.isArray(result.roomPrices) ? result.roomPrices : [],
      pageSnapshot: result.pageSnapshot || null,
      outputPath: result.outputPath || '',
      writeResult: result.writeResult || null,
      error: result.error || ''
    })),
    ...failedItems.map((item, index) => ({
      index: item.index || childResults.length + index + 1,
      success: false,
      url: item.url || '',
      requestedUrl: item.url || '',
      resolvedUrl: '',
      source: item.source || '',
      hotelId: item.hotelId || '',
      hotelName: '',
      eligibleCount: 0,
      eligibleRoomTypes: [],
      totalPrice: null,
      roomPrices: [],
      pageSnapshot: null,
      outputPath: '',
      writeResult: null,
      error: item.error || ''
    }))
  ];

  return items.sort((left, right) => left.index - right.index);
}

function buildBatchOutputPayload({
  args,
  template,
  matchedTemplate,
  effectiveTemplate,
  compareAppSettings,
  expandedInputs,
  resultPayloads,
  childResults,
  failedItems,
  allHotels,
  writeResult,
  performance
}) {
  const firstPayload = resultPayloads[0] || {};
  const firstHotel = allHotels[0] || firstPayload.hotel || null;
  const reviewInputs = resultPayloads.map((payload) => payload.review_input).filter(Boolean);
  const batchStats = {
    ...(expandedInputs.summary || {}),
    succeededCount: childResults.length,
    failedCount: failedItems.length,
    eligibleHotelRecordCount: allHotels.length,
    performance: performance || null
  };

  return sanitizeSensitiveData({
    hotels: allHotels,
    hotel: firstHotel,
    review_input: reviewInputs[0] || null,
    review_inputs: reviewInputs,
    compare_app_store: getCompareAppStorePath(),
    matched_template: matchedTemplate,
    effective_template: effectiveTemplate,
    compare_app_settings: compareAppSettings,
    batchMode: true,
    items: buildBatchItems(childResults, failedItems),
    batchStats,
    batch: {
      inputMode: expandedInputs.inputMode,
      requestedUrls: expandedInputs.requestedUrls,
      expandedHotelUrls: expandedInputs.hotelInputs.map((item) => item.url),
      summary: expandedInputs.summary,
      listResults: expandedInputs.listResults,
      skippedUrls: expandedInputs.skippedUrls,
      succeededCount: childResults.length,
      failedCount: failedItems.length,
      stats: batchStats,
      failedItems
    },
    scrape_debug: {
      requested_url: template.ctrip_url,
      requested_urls: expandedInputs.requestedUrls,
      resolved_urls: expandedInputs.hotelInputs.map((item) => item.url),
      batch_results: childResults,
      failed_items: failedItems,
      item_debug: resultPayloads.map((payload) => payload.scrape_debug).filter(Boolean),
      write_result: writeResult || null,
      list_prefilter: {
        summary: expandedInputs.summary,
        results: expandedInputs.listResults
      },
      source_args: {
        targetCount: args.targetCount ?? args['target-count'] ?? null
      },
      performance: performance || null
    }
  });
}

function buildBatchResult({
  startedAt,
  outputPath,
  effectiveTemplate,
  matchedTemplate,
  expandedInputs,
  allHotels,
  childResults,
  failedItems,
  compareAppSettings,
  writeResult,
  cleanupResult,
  reviewInput,
  performance
}) {
  const firstHotel = allHotels[0] || {};
  const firstResult = childResults[0] || {};
  const firstRoom = Array.isArray(firstResult.eligibleRoomTypes)
    ? firstResult.eligibleRoomTypes[0] || {}
    : {};
  const finishedAt = new Date().toISOString();
  const batchSummary = {
    ...(expandedInputs.summary || {}),
    succeededCount: childResults.length,
    failedCount: failedItems.length,
    eligibleHotelRecordCount: allHotels.length,
    performance: performance || null
  };

  return {
    success: true,
    batchMode: true,
    startedAt,
    finishedAt,
    outputPath,
    compareAppStorePath: getCompareAppStorePath(),
    templateName: effectiveTemplate.template_name,
    templateId: firstHotel.template_id ?? effectiveTemplate.template_id ?? null,
    requestedUrl: (expandedInputs.requestedUrls || [])[0] || '',
    requestedUrls: expandedInputs.requestedUrls || [],
    resolvedUrl:
      (expandedInputs.hotelInputs &&
        expandedInputs.hotelInputs[0] &&
        expandedInputs.hotelInputs[0].url) ||
      '',
    resolvedUrls: expandedInputs.hotelInputs.map((item) => item.url),
    inputMode: expandedInputs.inputMode,
    batchSummary,
    batchStats: batchSummary,
    items: buildBatchItems(childResults, failedItems),
    templateSnapshot: {
      matchedTemplate: buildTemplateSnapshot(
        matchedTemplate,
        matchedTemplate ? 'store.templates' : ''
      ),
      effectiveTemplate: buildTemplateSnapshot(effectiveTemplate, 'effective-template')
    },
    hotelName: firstHotel.name || firstResult.hotelName || '',
    eligibleCount: allHotels.length,
    eligibleHotels: allHotels,
    eligibleRoomTypes: childResults.flatMap((result) =>
      Array.isArray(result.eligibleRoomTypes) ? result.eligibleRoomTypes : []
    ),
    roomType: firstHotel.room_type || firstResult.roomType || firstRoom.roomType || '',
    roomOccupancy: firstHotel.room_count ?? firstResult.roomOccupancy ?? null,
    roomPrices: firstResult.roomPrices || [],
    totalPrice: firstHotel.total_price ?? firstResult.totalPrice ?? null,
    ctripScore: firstHotel.ctrip_score ?? firstResult.ctripScore ?? null,
    distance: firstHotel.distance ?? firstResult.distance ?? '',
    subwayDistance: firstHotel.subway_distance ?? firstResult.subwayDistance ?? '',
    transportTime: firstHotel.transport_time ?? firstResult.transportTime ?? '',
    busRoute: firstHotel.bus_route ?? firstResult.busRoute ?? '',
    pageSnapshot: firstResult.pageSnapshot || null,
    compareAppSettings: sanitizeSensitiveData(compareAppSettings),
    writeResult,
    cleanupResult,
    reviewInput,
    performance,
    failedItems
  };
}

async function runPreparedSingleDetailImport(context) {
  const {
    args,
    startedAt,
    taskId,
    emit,
    signal,
    outputDir,
    template,
    matchedTemplate,
    effectiveTemplate,
    compareAppSettings,
    effectiveDestination,
    hotelInput,
    outputPath: preferredOutputPath,
    autoEdge,
    transitCache,
    writeAppData = false,
    perf = null,
    pageIndex = null
  } = context;
  const itemPerf = perf
    ? perf.child({
        taskId,
        url: hotelInput.url,
        pageIndex
      })
    : new PerfTimer(setup_perf_logger(), { taskId, url: hotelInput.url, pageIndex });

  const totalStartedAt = Date.now();
  const performance = {
    totalMs: 0,
    scrapeMs: 0,
    transitMs: 0,
    outputWriteMs: 0,
    cleanupMs: 0,
    appWriteMs: 0,
    scrape: null
  };
  const itemTemplate = {
    ...effectiveTemplate,
    ctrip_url: hotelInput.url
  };

  assertNotCancelled(signal);
  emit('scrape:start', '正在采集携程酒店页面');
  const scrapeStartedAt = Date.now();
  const scraped = await scrapeCtripHotel(itemTemplate.ctrip_url, itemTemplate, {
    htmlPath: args.html,
    saveHtml: Boolean(args['save-html']),
    snapshotDir: path.join(outputDir, 'raw-pages'),
    matchingOptions: {
      includeFourPersonRoomsForThreePersonTemplate: Boolean(
        compareAppSettings.includeFourPersonRoomsForThreePersonTemplate
      )
    },
    edgeSession: buildEdgeSessionOptions(itemTemplate),
    autoEdge,
    perf: itemPerf.child({ url: itemTemplate.ctrip_url })
  });
  performance.scrapeMs = durationSince(scrapeStartedAt);
  performance.scrape = scraped.performance || null;

  assertNotCancelled(signal);
  emit('transit:start', '正在计算交通与地铁信息');
  const transitStartedAt = Date.now();
  const transit = await getTransitInfo(
    scraped.address,
    effectiveDestination,
    args.amapKey || DEFAULT_AMAP_KEY,
    {
      hotelGeo: scraped.geo,
      cache: transitCache
    }
  );
  performance.transitMs = durationSince(transitStartedAt);

  const { eligibleRoomRecords, hotelRecord, eligibleRoomSummaries, reviewInput } =
    await itemPerf.runPhase('parse_data', { url: itemTemplate.ctrip_url }, async () => {
      const nextEligibleRoomRecords = buildEligibleRoomRecords(
        itemTemplate,
        scraped,
        transit,
        matchedTemplate
      );
      const nextHotelRecord =
        nextEligibleRoomRecords[0] ||
        buildHotelRecord(itemTemplate, scraped, transit, matchedTemplate);
      const nextEligibleRoomSummaries = nextEligibleRoomRecords.map((roomRecord, index) => {
        const sourceRoom = Array.isArray(scraped.eligible_rooms)
          ? scraped.eligible_rooms[index] || {}
          : {};
        return {
          roomType: roomRecord.room_type,
          originalRoomType: roomRecord.original_room_type,
          dailyPrice: roomRecord.daily_price,
          totalPrice: roomRecord.total_price,
          occupancy: sourceRoom.occupancy ?? null,
          cancelPolicy: roomRecord.cancel_policy || '',
          windowStatus: roomRecord.window_status || ''
        };
      });
      const nextReviewInput = buildReviewInput({
        taskMeta: {
          taskId,
          url: itemTemplate.ctrip_url,
          templateId: nextHotelRecord.template_id,
          templateName: itemTemplate.template_name,
          checkInDate: itemTemplate.check_in_date,
          checkOutDate: itemTemplate.check_out_date,
          roomCount: itemTemplate.room_count,
          guestCount: itemTemplate.room_count,
          destination: effectiveDestination
        },
        finalHotels:
          nextEligibleRoomRecords.length > 0 ? nextEligibleRoomRecords : [nextHotelRecord],
        roomCandidates: scraped.raw_room_candidates || scraped.room_candidates || [],
        evaluations:
          scraped.room_selection_diagnostics &&
          Array.isArray(scraped.room_selection_diagnostics.evaluations)
            ? scraped.room_selection_diagnostics.evaluations
            : [],
        pageSnapshot: scraped.page_snapshot,
        template: itemTemplate
      });
      return {
        eligibleRoomRecords: nextEligibleRoomRecords,
        hotelRecord: nextHotelRecord,
        eligibleRoomSummaries: nextEligibleRoomSummaries,
        reviewInput: nextReviewInput
      };
    });

  const outputPath = path.resolve(
    preferredOutputPath || path.join(outputDir, `${slugify(hotelRecord.name || 'hotel')}.json`)
  );

  const outputPayload = sanitizeSensitiveData({
    hotels: eligibleRoomRecords,
    hotel: hotelRecord,
    review_input: reviewInput,
    compare_app_store: getCompareAppStorePath(),
    matched_template: matchedTemplate,
    effective_template: itemTemplate,
    compare_app_settings: compareAppSettings,
    scrape_debug: {
      requested_url: hotelInput.requestedUrl || hotelInput.url || template.ctrip_url,
      resolved_url: itemTemplate.ctrip_url,
      selected_room: scraped.room,
      eligible_rooms: scraped.eligible_rooms,
      room_candidates: scraped.room_candidates,
      raw_room_candidates: scraped.raw_room_candidates,
      selection_logs: reviewInput.selectionLogs,
      rejected_room_types: reviewInput.rejectedRoomTypes,
      normalize_logs: reviewInput.normalizeLogs,
      page_snapshot: scraped.page_snapshot,
      transit,
      performance
    }
  });

  const outputWriteStartedAt = Date.now();
  await itemPerf.runPhase('save_data', { url: itemTemplate.ctrip_url }, async () => {
    writeJsonFile(outputPath, outputPayload);
  });
  performance.outputWriteMs = durationSince(outputWriteStartedAt);
  outputPayload.scrape_debug.performance = performance;

  const cleanupStartedAt = Date.now();
  const cleanupResult = await itemPerf.runPhase(
    'close_resource',
    { url: itemTemplate.ctrip_url },
    async () =>
      cleanupOutputArtifacts(
        outputDir,
        outputPath,
        scraped.page_snapshot && scraped.page_snapshot.saved_html_files
      )
  );
  performance.cleanupMs = durationSince(cleanupStartedAt);

  let writeResult = null;
  if (writeAppData) {
    emit('write:start', '正在写入宾馆比较数据');
    const appWriteStartedAt = Date.now();
    writeResult = await itemPerf.runPhase(
      'save_data',
      { url: itemTemplate.ctrip_url, hotelCount: eligibleRoomRecords.length },
      async () => {
        if (shouldSkipHotelWrite(eligibleRoomRecords)) {
          return {
            storePath: getCompareAppStorePath(),
            operation: 'skipped',
            skippedCount: eligibleRoomRecords.length,
            reason:
              '所有候选房型都明确写了不可取消、不支持取消，或仅支持订单确认后短时间内免费取消；按当前规则整家跳过，未直写比较助手。'
          };
        }
        return appendHotelsToStore(eligibleRoomRecords, { replaceExistingGroup: true });
      }
    );
    performance.appWriteMs = durationSince(appWriteStartedAt);
  }

  performance.totalMs = durationSince(totalStartedAt);
  if (outputPayload.scrape_debug) {
    outputPayload.scrape_debug.performance = performance;
  }
  await itemPerf.runPhase('save_data', { url: itemTemplate.ctrip_url }, async () => {
    writeJsonFile(outputPath, outputPayload);
  });

  const finishedAt = new Date().toISOString();
  const result = {
    success: true,
    startedAt,
    finishedAt,
    outputPath,
    compareAppStorePath: getCompareAppStorePath(),
    templateName: itemTemplate.template_name,
    templateId: hotelRecord.template_id,
    requestedUrl: hotelInput.requestedUrl || hotelInput.url || template.ctrip_url,
    resolvedUrl: itemTemplate.ctrip_url,
    templateSnapshot: {
      matchedTemplate: buildTemplateSnapshot(
        matchedTemplate,
        matchedTemplate ? 'store.templates' : ''
      ),
      effectiveTemplate: buildTemplateSnapshot(itemTemplate, 'effective-template')
    },
    hotelName: hotelRecord.name,
    eligibleCount: eligibleRoomRecords.length,
    eligibleHotels: eligibleRoomRecords,
    eligibleRoomTypes: eligibleRoomSummaries,
    roomType: hotelRecord.room_type,
    roomOccupancy: scraped.room ? (scraped.room.occupancy ?? null) : null,
    roomPrices: scraped.room && Array.isArray(scraped.room.prices) ? scraped.room.prices : [],
    totalPrice: hotelRecord.total_price,
    ctripScore: hotelRecord.ctrip_score,
    distance: hotelRecord.distance,
    subwayDistance: hotelRecord.subway_distance,
    transportTime: hotelRecord.transport_time,
    busRoute: hotelRecord.bus_route,
    pageSnapshot: buildPageSnapshotSummary(outputPayload.scrape_debug.page_snapshot),
    compareAppSettings: sanitizeSensitiveData(compareAppSettings),
    writeResult,
    cleanupResult,
    reviewInput,
    performance
  };

  return {
    result,
    outputPayload
  };
}

async function runBatchHotelImportTask(context) {
  const {
    args,
    startedAt,
    taskId,
    emit,
    signal,
    latestRunPath,
    outputDir,
    template,
    matchedTemplate,
    effectiveTemplate,
    compareAppSettings,
    effectiveDestination,
    expandedInputs
  } = context;

  const batchPerf = context.perf
    ? context.perf.child({
        taskId,
        hotelCount: expandedInputs.hotelInputs.length
      })
    : new PerfTimer(setup_perf_logger(), {
        taskId,
        hotelCount: expandedInputs.hotelInputs.length
      });
  const batchStats = new BatchStats(batchPerf, {
    hotelCount: expandedInputs.hotelInputs.length
  });
  const batchPhase = batchPerf.phase('batch_total', {
    hotelCount: expandedInputs.hotelInputs.length
  });

  try {
    emit('batch:start', '正在批量采集携程酒店页面', {
      summary: describeExpandedInput(expandedInputs)
    });

    const batchStartedAt = Date.now();
    const batchItemsDir = path.join(outputDir, 'batch-items');
    ensureDir(batchItemsDir);
    const performance = {
      totalMs: 0,
      itemMs: 0,
      writeMs: 0,
      outputWriteMs: 0,
      cleanupMs: 0,
      listExpansion:
        expandedInputs.performance ||
        (expandedInputs.summary && expandedInputs.summary.performance) ||
        null,
      items: []
    };
    const transitCache = createTransitCache();
    const childResults = [];
    const resultPayloads = [];
    const failedItems = [];

    for (let index = 0; index < expandedInputs.hotelInputs.length; index += 1) {
      assertNotCancelled(signal);
      const hotelInput = expandedInputs.hotelInputs[index];
      emit(
        'batch:item-start',
        `正在采集第 ${index + 1}/${expandedInputs.hotelInputs.length} 家酒店`,
        {
          url: hotelInput.url,
          source: hotelInput.source
        }
      );

      const childOutputPath = path.join(
        batchItemsDir,
        `batch-item-${String(index + 1).padStart(3, '0')}-${hotelInput.hotelId || 'hotel'}.json`
      );

      try {
        const itemStartedAt = Date.now();
        const preparedResult = await runPreparedSingleDetailImport({
          args,
          startedAt,
          taskId: `${taskId}-${index + 1}`,
          emit,
          signal,
          outputDir,
          template,
          matchedTemplate,
          effectiveTemplate,
          compareAppSettings,
          effectiveDestination,
          hotelInput,
          outputPath: childOutputPath,
          autoEdge: Boolean(args['auto-edge']),
          transitCache,
          writeAppData: false,
          perf: batchPerf,
          pageIndex: index + 1
        });
        const childResult = preparedResult.result;
        const childPayload = preparedResult.outputPayload;
        resultPayloads.push(childPayload);
        childResult.inputIndex = index + 1;
        childResult.inputSource = hotelInput.source;
        childResult.hotelId = hotelInput.hotelId;
        childResult.listCandidate = hotelInput.listCandidate || null;
        childResults.push(childResult);
        const itemDurationMs = durationSince(itemStartedAt);
        performance.itemMs += itemDurationMs;
        performance.items.push({
          index: index + 1,
          hotelId: hotelInput.hotelId,
          hotelName: childResult.hotelName,
          durationMs: itemDurationMs,
          detail: childResult.performance || null
        });
        batchStats.recordTask({
          taskId: `${taskId}-${index + 1}`,
          status: 'success',
          elapsedMs: itemDurationMs,
          url: hotelInput.url
        });
        emit('batch:item-done', `第 ${index + 1} 家酒店采集完成`, {
          hotelName: childResult.hotelName,
          eligibleCount: childResult.eligibleCount
        });
      } catch (error) {
        const failedItem = {
          index: index + 1,
          url: hotelInput.url,
          source: hotelInput.source,
          hotelId: hotelInput.hotelId,
          error: error && error.message ? error.message : String(error)
        };
        failedItems.push(failedItem);
        batchStats.recordTask({
          taskId: `${taskId}-${index + 1}`,
          status: 'failed',
          elapsedMs: 0,
          url: hotelInput.url
        });
        emit('batch:item-error', `第 ${index + 1} 家酒店采集失败`, failedItem);
      }
    }

    const allHotels = resultPayloads.flatMap((payload) =>
      Array.isArray(payload.hotels) ? payload.hotels : []
    );
    const reviewInput =
      resultPayloads.map((payload) => payload && payload.review_input).filter(Boolean)[0] || null;

    let writeResult = null;
    if (args['write-app-data']) {
      emit('write:start', '正在批量写入宾馆比较数据');
      const writeStartedAt = Date.now();
      writeResult = await batchPerf.runPhase(
        'save_data',
        { hotelCount: allHotels.length },
        async () => {
          if (shouldSkipHotelWrite(allHotels)) {
            return {
              storePath: getCompareAppStorePath(),
              operation: 'skipped',
              skippedCount: allHotels.length,
              reason:
                '所有候选房型都明确写了不可取消、不支持取消，或仅支持订单确认后短时间内免费取消；按当前规则整批跳过，未直写比较助手。'
            };
          }

          return resultPayloads.map((payload, index) => {
            const hotels = Array.isArray(payload.hotels) ? payload.hotels : [];
            if (shouldSkipHotelWrite(hotels)) {
              return {
                itemIndex: index + 1,
                storePath: getCompareAppStorePath(),
                operation: 'skipped',
                skippedCount: hotels.length,
                reason:
                  '该酒店所有候选房型都明确写了不可取消、不支持取消，或仅支持订单确认后短时间内免费取消；按当前规则跳过。'
              };
            }

            return {
              itemIndex: index + 1,
              result: appendHotelsToStore(hotels, { replaceExistingGroup: true })
            };
          });
        }
      );
      performance.writeMs = durationSince(writeStartedAt);
    }

    const outputPath = path.resolve(
      args.out ||
        path.join(
          outputDir,
          `batch-${slugify(effectiveTemplate.template_name || (matchedTemplate && matchedTemplate.name) || 'ctrip-hotels')}.json`
        )
    );
    performance.totalMs = durationSince(batchStartedAt);
    const outputPayload = buildBatchOutputPayload({
      args,
      template,
      matchedTemplate,
      effectiveTemplate,
      compareAppSettings,
      expandedInputs,
      resultPayloads,
      childResults,
      failedItems,
      allHotels,
      reviewInput,
      writeResult,
      performance
    });
    const outputWriteStartedAt = Date.now();
    await batchPerf.runPhase('save_data', { hotelCount: allHotels.length }, async () => {
      writeJsonFile(outputPath, outputPayload);
    });
    performance.outputWriteMs = durationSince(outputWriteStartedAt);

    const snapshotFiles = resultPayloads.flatMap((payload) => {
      const pageSnapshot = payload && payload.scrape_debug && payload.scrape_debug.page_snapshot;
      return pageSnapshot && Array.isArray(pageSnapshot.saved_html_files)
        ? pageSnapshot.saved_html_files
        : [];
    });
    const cleanupStartedAt = Date.now();
    const cleanupResult = await batchPerf.runPhase(
      'close_resource',
      { hotelCount: allHotels.length },
      async () => cleanupOutputArtifacts(outputDir, outputPath, snapshotFiles)
    );
    performance.cleanupMs = durationSince(cleanupStartedAt);
    performance.totalMs = durationSince(batchStartedAt);
    if (outputPayload.batchStats) {
      outputPayload.batchStats.performance = performance;
    }
    if (outputPayload.batch && outputPayload.batch.stats) {
      outputPayload.batch.stats.performance = performance;
    }
    if (outputPayload.scrape_debug) {
      outputPayload.scrape_debug.performance = performance;
    }
    await batchPerf.runPhase('save_data', { hotelCount: allHotels.length }, async () => {
      writeJsonFile(outputPath, outputPayload);
    });
    const result = buildBatchResult({
      startedAt,
      outputPath,
      effectiveTemplate,
      matchedTemplate,
      expandedInputs,
      allHotels,
      childResults,
      failedItems,
      compareAppSettings,
      writeResult,
      cleanupResult,
      reviewInput,
      performance
    });

    writeLatestRunFile(
      latestRunPath,
      buildRunSummary({
        ...result,
        eligibleHotels: allHotels
      })
    );
    emit('task:done', '批量采集任务完成', {
      inputMode: expandedInputs.inputMode,
      hotelCount: expandedInputs.hotelInputs.length,
      eligibleCount: result.eligibleCount,
      failedCount: failedItems.length,
      wrote: Boolean(writeResult)
    });
    batchStats.flush({
      hotelCount: expandedInputs.hotelInputs.length,
      elapsed_ms: performance.totalMs,
      status: failedItems.length ? 'partial' : 'success'
    });
    batchPhase.end(failedItems.length ? 'partial' : 'success', {
      hotelCount: expandedInputs.hotelInputs.length,
      elapsed_ms: performance.totalMs
    });
    return result;
  } catch (error) {
    batchPhase.error(error, {
      hotelCount: expandedInputs.hotelInputs.length
    });
    throw error;
  }
}

async function runHotelImportTask(rawArgs = {}, options = {}) {
  const args = normalizeTaskArgs(rawArgs);
  const startedAt = options.startedAt || new Date().toISOString();
  const taskId = options.taskId || args.taskId || `task-${Date.now()}`;
  const emit = createTaskEmitter(options.onEvent);
  const signal = options.signal || null;
  const latestRunPathInput = args.latestRun || DEFAULT_LATEST_RUN_PATH;
  const perfLogger = options.perfLogger || setup_perf_logger();
  const perf =
    options.perf ||
    new PerfTimer(perfLogger, {
      runId: options.runId || args.runId || taskId,
      taskId,
      city: args.city || args.destination || args.templateName || '',
      url: args.url || args.ctrip_url || args['ctrip-url'] || ''
    });
  if (!options.scriptStartLogged) {
    perf.event('script_start', {
      phase: 'script_start',
      status: 'success',
      elapsed_ms: 0,
      taskId
    });
  }

  return perf.runPhase('task_total', { taskId }, async () =>
    withWorkingDirectory(options.workingDirectory, async () => {
      const latestRunPath = path.resolve(latestRunPathInput);
      assertNotCancelled(signal);

      if (args['apply-output']) {
        emit('apply:start', '正在回写已复核的采集结果');
        applyReviewedOutput(args['apply-output'], latestRunPath, startedAt, {
          overwriteExistingGroup: Boolean(args['overwrite-existing-group'])
        });
        emit('apply:done', '已完成回写');
        return buildRunSummary(
          require('./utils').readJsonFile(latestRunPath, {
            success: true,
            startedAt,
            finishedAt: new Date().toISOString()
          })
        );
      }

      if (args['write-app-data'] && !args['unsafe-allow-unreviewed-write']) {
        throw new Error(
          '`--write-app-data` 已默认禁用。它会跳过最终房型复核并直接写入比较助手。只有在明确接受风险时，才同时传入 `--unsafe-allow-unreviewed-write`。'
        );
      }

      emit('template:start', '正在读取模板与比较助手设置');
      const {
        store,
        compareAppSettings,
        template,
        matchedTemplate,
        effectiveTemplate,
        effectiveDestination
      } = await perf.runPhase('load_config', { taskId }, async () => {
        const loadedStore = loadCompareAppStore();
        const loadedCompareAppSettings = {
          ...BASE_COMPARE_APP_SETTINGS,
          ...((loadedStore && loadedStore.settings) || {})
        };
        const templateFromFile = args.template ? loadTemplate(args.template) : {};
        const loadedTemplate = mergeTemplateWithArgs(templateFromFile, args);
        const loadedMatchedTemplate = findTemplateInStore(
          loadedStore,
          loadedTemplate.template_id,
          loadedTemplate.template_name || args.templateName
        );
        const loadedEffectiveTemplate = applyMatchedTemplate(loadedTemplate, loadedMatchedTemplate);
        validateTemplate(loadedEffectiveTemplate);
        const loadedEffectiveDestination = normalizePlaceName(
          (loadedMatchedTemplate && loadedMatchedTemplate.destination) ||
            loadedEffectiveTemplate.destination
        );
        return {
          store: loadedStore,
          compareAppSettings: loadedCompareAppSettings,
          template: loadedTemplate,
          matchedTemplate: loadedMatchedTemplate,
          effectiveTemplate: loadedEffectiveTemplate,
          effectiveDestination: loadedEffectiveDestination
        };
      });
      void store;

      const outputDir = path.resolve('output');
      ensureDir(outputDir);

      let autoEdgePid = null;
      const autoEdge = Boolean(args['auto-edge']);

      try {
        assertNotCancelled(signal);
        if (autoEdge) {
          emit('edge:start', '正在准备 Edge 登录态');
          await perf.runPhase('browser_context', { taskId }, async () => {
            if (
              !hasReusableEdgeProfile(
                effectiveTemplate.edge_user_data_dir,
                effectiveTemplate.edge_profile_directory
              )
            ) {
              emit('edge:login-required', '首次采集需要登录携程后继续', {
                reason: '未检测到可复用的 Edge 携程登录资料。',
                instruction:
                  '程序会打开一个可见 Edge 窗口。请在窗口中登录携程，确认酒店页能看到价格后关闭该窗口，当前采集任务会自动继续。'
              });
              await runInteractiveEdgeLoginPrep({
                userDataDir: effectiveTemplate.edge_user_data_dir,
                profileDirectory: effectiveTemplate.edge_profile_directory,
                port: effectiveTemplate.edge_debugging_port || 9222,
                url: effectiveTemplate.ctrip_url || 'https://hotels.ctrip.com/'
              });
              emit('edge:login-done', '携程登录窗口已关闭，继续后台采集');
            }
          });

          const edgeResult = await perf.runPhase('browser_launch', { taskId }, async () =>
            launchAndWaitForEdge({
              userDataDir: effectiveTemplate.edge_user_data_dir,
              profileDirectory: effectiveTemplate.edge_profile_directory,
              port: effectiveTemplate.edge_debugging_port || 9222,
              url: 'about:blank',
              headless: effectiveTemplate.edge_headless
            })
          );
          autoEdgePid = edgeResult.pid;
          if (!effectiveTemplate.edge_debugging_port) {
            effectiveTemplate.edge_debugging_port = edgeResult.port;
          }
        }

        assertNotCancelled(signal);
        const expandedInputs = await perf.runPhase('build_url', { taskId }, async () => {
          const listFilters = normalizeListFiltersFromArgs(args);
          return expandCtripHotelInputs(args, effectiveTemplate, listFilters, {
            autoEdge,
            edgeSession: buildEdgeSessionOptions(effectiveTemplate)
          });
        });
        if (!expandedInputs.hotelInputs.length) {
          const skippedReason = expandedInputs.skippedUrls
            .map((item) => `${item.url}: ${item.reason}`)
            .join('; ');
          const listSummary = expandedInputs.summary || {};
          const listErrors = expandedInputs.listResults
            .flatMap((item) => (Array.isArray(item.errors) ? item.errors : []))
            .map((item) => item.error)
            .filter(Boolean)
            .join('; ');
          if (Number(listSummary.listInputCount || 0) > 0) {
            throw new Error(
              listErrors ||
                '已识别携程酒店列表页，但没有解析到可进入详情页的候选酒店。请确认 Edge 携程登录态可用，或放宽列表页前筛条件后重试。'
            );
          }
          throw new Error(skippedReason || '未从输入中解析到可采集的携程酒店详情页或列表页 URL。');
        }

        if (expandedInputs.inputMode !== 'detail' || expandedInputs.hotelInputs.length !== 1) {
          return await runBatchHotelImportTask({
            args,
            startedAt,
            taskId,
            emit,
            signal,
            latestRunPath,
            outputDir,
            template,
            matchedTemplate,
            effectiveTemplate,
            compareAppSettings,
            effectiveDestination,
            expandedInputs,
            options,
            perf
          });
        }

        const preparedResult = await runPreparedSingleDetailImport({
          args,
          startedAt,
          taskId,
          emit,
          signal,
          outputDir,
          template,
          matchedTemplate,
          effectiveTemplate,
          compareAppSettings,
          effectiveDestination,
          hotelInput: expandedInputs.hotelInputs[0],
          outputPath: args.out,
          autoEdge,
          transitCache: null,
          writeAppData: Boolean(args['write-app-data']),
          perf,
          pageIndex: 1
        });
        const result = preparedResult.result;

        await perf.runPhase('save_data', { taskId, hotelCount: result.eligibleCount }, async () => {
          writeLatestRunFile(
            latestRunPath,
            buildRunSummary({
              ...result,
              eligibleHotels: result.eligibleHotels
            })
          );
        });
        emit('task:done', '采集任务完成', {
          hotelName: result.hotelName,
          eligibleCount: result.eligibleCount,
          wrote: Boolean(result.writeResult)
        });
        return result;
      } finally {
        if (autoEdge && autoEdgePid) {
          await perf.runPhase('close_resource', { taskId }, async () => {
            closeAutoEdge(autoEdgePid);
          });
        }
      }
    })
  );
}

module.exports = {
  buildFailureResult,
  buildTemplateSnapshot,
  runHotelImportTask,
  writeFailureSummary
};
