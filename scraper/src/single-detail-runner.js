const { buildRoomSelectionDiagnostics, selectBestRoom } = require('./scraper/room-logic');
const path = require('path');
const { getCtripAccessController } = require('./ctrip-access-controller');
const { captureKey, rawCaptureKey } = require('./task-capture-cache');
const { DEFAULT_AMAP_KEY } = require('./constants');
const { scrapeCtripHotel } = require('./ctrip-scraper');
const { getCompareAppStorePath } = require('./compare-app-bridge');
const { buildPageSnapshotSummary } = require('./cli/run-summary');
const { getTransitInfo } = require('./amap');
const { buildHotelRecord, buildEligibleRoomRecords } = require('./hotel-record');
const {
  filterHotelsByPerPersonDailyPrice,
  summarizePriceFilter
} = require('./result-price-filter');
const {
  cleanupOutputArtifacts,
  sanitizeSensitiveData,
  slugify,
  writeJsonFileAsync
} = require('./utils');
const { setup_perf_logger, PerfTimer } = require('./runtime/perf');
const {
  assertNotCancelled,
  buildEdgeSessionOptions,
  buildTemplateSnapshot,
  durationSince,
  isReportDisabled,
  shouldCleanupOutputArtifactsForRun
} = require('./task-context');
const { writeSingleHotelRecords } = require('./task-writeback');
const { toBoolean } = require('./edge-runtime');

function isScrapedLoginRequired(scraped = {}) {
  return Boolean(scraped && scraped.page_snapshot && scraped.page_snapshot.login_required);
}

function buildObservedRoomSummaries(scraped = {}) {
  return (Array.isArray(scraped.room_candidates) ? scraped.room_candidates : [])
    .map((room) => ({
      room_type: String(room.standard_title || room.title || '').trim(),
      original_room_type: String(room.original_title || room.title || '').trim(),
      price_visible: room.price !== null && room.price !== undefined && !room.price_locked
    }))
    .filter((room) => room.room_type || room.original_room_type);
}

class SingleDetailRunner {
  createPreparedScrapeState(context) {
    const { taskId, effectiveTemplate, hotelInput, perf = null, pageIndex = null } = context;
    const itemPerf = perf
      ? perf.child({
          taskId,
          url: hotelInput.url,
          pageIndex
        })
      : new PerfTimer(setup_perf_logger(), { taskId, url: hotelInput.url, pageIndex });

    return {
      context,
      itemPerf,
      totalStartedAt: Date.now(),
      performance: {
        totalMs: 0,
        scrapeMs: 0,
        transitMs: 0,
        outputWriteMs: 0,
        cleanupMs: 0,
        appWriteMs: 0,
        scrape: null
      },
      itemTemplate: {
        ...effectiveTemplate,
        ctrip_url: hotelInput.url
      },
      scraped: null,
      skipTransit: false,
      skipTransitBecauseNoEligibleRooms: false
    };
  }

  async collectPreparedScrape(context) {
    const prepared = this.createPreparedScrapeState(context);
    const {
      args,
      emit,
      signal,
      outputDir,
      compareAppSettings,
      autoEdge,
      isBatchItem = false,
      captureStrategy: contextCaptureStrategy = null,
      edgeParallelCancelPolicy: contextEdgeParallelCancelPolicy = null,
      scrapeEventForwarder = emit
    } = context;
    const { itemTemplate, itemPerf, performance } = prepared;

    const checkpointKey = captureKey(itemTemplate.ctrip_url, itemTemplate, 0, compareAppSettings);
    prepared.checkpointKey = checkpointKey;
    const restored = context.checkpoint?.get(checkpointKey);
    if (restored) {
      prepared.restored = restored;
      return prepared;
    }
    assertNotCancelled(signal);
    emit('scrape:start', '正在采集携程酒店页面');
    const scrapeStartedAt = Date.now();
    const accessController =
      !args.html && (autoEdge || context.accessController)
        ? context.accessController || getCtripAccessController(itemTemplate.edge_user_data_dir)
        : null;
    const collect = (attemptSignal) =>
      scrapeCtripHotel(itemTemplate.ctrip_url, itemTemplate, {
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
        captureStrategy:
          args.captureStrategy ||
          args['capture-strategy'] ||
          contextCaptureStrategy ||
          (autoEdge ? 'browser_first' : null),
        edgeParallelCancelPolicy:
          args.edgeParallelCancelPolicy ||
          args['edge-parallel-cancel-policy'] ||
          contextEdgeParallelCancelPolicy ||
          'none',
        includeMobileHtml:
          !autoEdge &&
          !context.accessController &&
          !isBatchItem &&
          toBoolean(args.includeMobileHtml ?? args['include-mobile-html'], false),
        directRoomReplay:
          !autoEdge &&
          !context.accessController &&
          !isBatchItem &&
          toBoolean(args.directRoomReplay ?? args['direct-room-replay'], false),
        onEvent: scrapeEventForwarder,
        perf: itemPerf.child({ url: itemTemplate.ctrip_url }),
        accessController,
        signal: attemptSignal || signal
      });
    const runCapture = () =>
      accessController ? accessController.run(collect, { signal }) : collect(signal);
    const cache = context.captureCache;
    const scraped = cache
      ? await cache.getOrCollect(
          rawCaptureKey(itemTemplate.ctrip_url, itemTemplate, accessController?.epoch || 0),
          runCapture
        )
      : await runCapture();
    if (
      cache &&
      scraped.page_snapshot?.capture_complete &&
      Array.isArray(scraped.raw_room_candidates)
    ) {
      const matchingOptions = {
        includeFourPersonRoomsForThreePersonTemplate: Boolean(
          compareAppSettings.includeFourPersonRoomsForThreePersonTemplate
        )
      };
      scraped.room_selection_diagnostics = buildRoomSelectionDiagnostics(
        scraped.raw_room_candidates,
        itemTemplate,
        matchingOptions
      );
      scraped.eligible_rooms = scraped.room_selection_diagnostics.eligibleRooms;
      scraped.room = selectBestRoom(scraped.raw_room_candidates, itemTemplate, matchingOptions);
      scraped.page_snapshot.eligible_room_count = scraped.eligible_rooms.length;
      scraped.page_snapshot.room_price_visible = Boolean(scraped.room?.price != null);
    }
    performance.scrapeMs = durationSince(scrapeStartedAt);
    performance.scrape = scraped.performance || null;
    prepared.scraped = scraped;

    assertNotCancelled(signal);
    const hasEligibleScrapedRooms =
      !isScrapedLoginRequired(scraped) &&
      Array.isArray(scraped.eligible_rooms) &&
      scraped.eligible_rooms.length > 0;
    const skipTransitBecauseNoEligibleRooms = Boolean(isBatchItem && !hasEligibleScrapedRooms);
    const skipTransit = Boolean(
      args.skipTransit || args['skip-transit'] || skipTransitBecauseNoEligibleRooms
    );
    prepared.skipTransit = skipTransit;
    prepared.skipTransitBecauseNoEligibleRooms = skipTransitBecauseNoEligibleRooms;

    return prepared;
  }

  async resolveTransit(prepared) {
    const { context, itemPerf, itemTemplate, performance, scraped } = prepared;
    const { args, emit, signal, effectiveDestination, transitCache } = context;
    let transit = null;
    if (!prepared.skipTransit) {
      assertNotCancelled(signal);
      emit('transit:start', '正在计算交通与地铁信息');
      const transitStartedAt = Date.now();
      transit = await getTransitInfo(
        scraped.address,
        effectiveDestination,
        args.amapKey || DEFAULT_AMAP_KEY,
        {
          hotelGeo: scraped.geo,
          cache: transitCache
        }
      );
      performance.transitMs = durationSince(transitStartedAt);
    } else {
      performance.transitMs = 0;
      if (prepared.skipTransitBecauseNoEligibleRooms) {
        performance.transitSkippedReason = 'no_eligible_rooms';
        itemPerf.event('transit_skipped', {
          reason: 'no_eligible_rooms',
          eligible_count: 0,
          url: itemTemplate.ctrip_url
        });
      }
    }

    return transit;
  }

  async buildPreparedResult(prepared, transit) {
    const { context, itemPerf, itemTemplate, performance, scraped, totalStartedAt } = prepared;
    const {
      args,
      startedAt,
      emit,
      signal,
      outputDir,
      template,
      matchedTemplate,
      compareAppSettings,
      hotelInput,
      outputPath: preferredOutputPath,
      writeAppData = false,
      reportLevel = 'normal'
    } = context;
    const reportDisabled = isReportDisabled(reportLevel);

    assertNotCancelled(signal);
    const { eligibleRoomRecords, hotelRecord, eligibleRoomSummaries, postFilter } =
      await itemPerf.runPhase('parse_data', { url: itemTemplate.ctrip_url }, async () => {
        const collectedRoomRecords = isScrapedLoginRequired(scraped)
          ? []
          : buildEligibleRoomRecords(itemTemplate, scraped, transit, matchedTemplate);
        const priceFilterResult = filterHotelsByPerPersonDailyPrice(
          collectedRoomRecords,
          args.perPersonDailyPriceMax ?? args['per-person-daily-price-max']
        );
        const nextEligibleRoomRecords = priceFilterResult.hotels;
        const nextPostFilter = summarizePriceFilter(priceFilterResult);
        const nextHotelRecord =
          nextEligibleRoomRecords[0] ||
          buildHotelRecord(itemTemplate, scraped, transit, matchedTemplate);
        const nextEligibleRoomSummaries = nextEligibleRoomRecords.map((roomRecord, index) => {
          const sourceIndex = priceFilterResult.keptIndexes[index] ?? index;
          const sourceRoom = Array.isArray(scraped.eligible_rooms)
            ? scraped.eligible_rooms[sourceIndex] || {}
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
        return {
          eligibleRoomRecords: nextEligibleRoomRecords,
          hotelRecord: nextHotelRecord,
          eligibleRoomSummaries: nextEligibleRoomSummaries,
          postFilter: nextPostFilter
        };
      });

    if (postFilter.removedCount > 0) {
      const allRemoved = postFilter.keptCount === 0;
      emit(
        'filter:price-limit',
        allRemoved
          ? `采集到的房型均超过每日人均 ${postFilter.perPersonDailyPriceMax} 元，已全部自动剔除`
          : `已自动剔除 ${postFilter.removedCount} 个超过每日人均 ${postFilter.perPersonDailyPriceMax} 元的房型`,
        postFilter
      );
    }

    const outputPath = reportDisabled
      ? ''
      : path.resolve(
          preferredOutputPath ||
            path.join(outputDir, `${slugify(hotelRecord.name || 'hotel')}.json`)
        );
    const loginRequired = isScrapedLoginRequired(scraped);
    const savedHtmlFiles =
      scraped.page_snapshot && Array.isArray(scraped.page_snapshot.saved_html_files)
        ? scraped.page_snapshot.saved_html_files
        : [];

    let cleanupResult = { deletedFiles: [], skipped: true };
    if (shouldCleanupOutputArtifactsForRun(reportLevel, args)) {
      const cleanupStartedAt = Date.now();
      cleanupResult = await itemPerf.runPhase(
        'close_resource',
        { url: itemTemplate.ctrip_url },
        async () => cleanupOutputArtifacts(outputDir, outputPath, savedHtmlFiles)
      );
      performance.cleanupMs = durationSince(cleanupStartedAt);
    }

    let writeResult = null;
    if (writeAppData && scraped.page_snapshot?.capture_complete !== false && !loginRequired) {
      emit('write:start', '正在写入宾馆比较数据');
      const appWriteStartedAt = Date.now();
      writeResult = await itemPerf.runPhase(
        'save_data',
        { url: itemTemplate.ctrip_url, hotelCount: eligibleRoomRecords.length },
        async () => writeSingleHotelRecords(eligibleRoomRecords)
      );
      performance.appWriteMs = durationSince(appWriteStartedAt);
    }

    performance.totalMs = durationSince(totalStartedAt);

    const isFullReport = reportLevel === 'full';
    let outputPayload = null;
    if (!reportDisabled) {
      const buildReportStartedAt = Date.now();
      outputPayload = await itemPerf.runPhase(
        'build_report',
        { url: itemTemplate.ctrip_url, reportLevel },
        async () =>
          sanitizeSensitiveData({
            hotels: eligibleRoomRecords,
            hotel: eligibleRoomRecords[0] || (postFilter.removedCount > 0 ? null : hotelRecord),
            post_filter: postFilter,
            filtered_hotel_reference:
              postFilter.removedCount > 0
                ? {
                    name: hotelRecord.name,
                    address: hotelRecord.address,
                    website: hotelRecord.website,
                    template_id: hotelRecord.template_id
                  }
                : undefined,
            compare_app_store: getCompareAppStorePath(),
            matched_template: matchedTemplate,
            effective_template: itemTemplate,
            compare_app_settings: compareAppSettings,
            reportLevel,
            scrape_debug: {
              requested_url: hotelInput.requestedUrl || hotelInput.url || template.ctrip_url,
              resolved_url: itemTemplate.ctrip_url,
              selected_room: scraped.room,
              eligible_rooms: scraped.eligible_rooms,
              room_candidates: scraped.room_candidates,
              raw_room_candidates: isFullReport ? scraped.raw_room_candidates : undefined,
              page_snapshot: scraped.page_snapshot,
              transit,
              performance
            }
          })
      );
      performance.buildReportMs = durationSince(buildReportStartedAt);

      const outputWriteStartedAt = Date.now();
      const writeReportPhase = itemPerf.phase('write_report', {
        url: itemTemplate.ctrip_url,
        reportLevel
      });
      const measure = await writeJsonFileAsync(outputPath, outputPayload, {
        pretty: isFullReport,
        measure: true
      });
      if (measure) {
        performance.reportBytes = measure.bytes;
        performance.reportStringifyMs = measure.stringifyMs;
        performance.reportWriteMs = measure.writeMs;
        performance.reportTotalWriteMs = measure.totalMs;
      }
      writeReportPhase.end('success', {
        report_bytes: measure ? measure.bytes : 0,
        report_stringify_ms: measure ? measure.stringifyMs : 0,
        report_file_write_ms: measure ? measure.writeMs : 0,
        report_total_write_ms: measure ? measure.totalMs : 0
      });
      performance.outputWriteMs = durationSince(outputWriteStartedAt);
    }

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
      observedRooms: buildObservedRoomSummaries(scraped),
      roomType: eligibleRoomRecords[0] ? hotelRecord.room_type : '',
      roomOccupancy: scraped.room ? (scraped.room.occupancy ?? null) : null,
      roomPrices:
        !loginRequired && scraped.room && Array.isArray(scraped.room.prices)
          ? scraped.room.prices
          : [],
      totalPrice:
        loginRequired || !eligibleRoomRecords[0] ? null : eligibleRoomRecords[0].total_price,
      ctripScore: hotelRecord.ctrip_score,
      distance: hotelRecord.distance,
      subwayDistance: hotelRecord.subway_distance,
      transportTime: hotelRecord.transport_time,
      busRoute: hotelRecord.bus_route,
      pageSnapshot: buildPageSnapshotSummary(scraped.page_snapshot),
      postFilter,
      writeResult,
      reportLevel,
      performance
    };
    if (!reportDisabled) {
      result.compareAppSettings = sanitizeSensitiveData(compareAppSettings);
      result.cleanupResult = cleanupResult;
    }

    return {
      result,
      outputPayload,
      savedHtmlFiles
    };
  }

  async completePreparedScrape(prepared) {
    if (prepared.restored) return prepared.restored;
    const transit = await this.resolveTransit(prepared);
    const completed = await this.buildPreparedResult(prepared, transit);
    completed.result.collectedAt =
      prepared.scraped.page_snapshot?.collected_at || new Date().toISOString();
    completed.result.checkpointKey = prepared.checkpointKey;
    completed.result.checkpointId = prepared.context.checkpoint?.id;
    completed.result.writeCommitted = Boolean(
      completed.result.writeResult && completed.result.writeResult.operation !== 'skipped'
    );
    prepared.context.checkpoint?.record(prepared.checkpointKey, completed);
    prepared.context.metrics?.recordResult(completed.result);
    return completed;
  }

  async run(context) {
    const prepared = await this.collectPreparedScrape(context);
    return this.completePreparedScrape(prepared);
  }
}

async function runPreparedSingleDetailImport(context) {
  return new SingleDetailRunner().run(context);
}

module.exports = {
  SingleDetailRunner,
  runPreparedSingleDetailImport
};
