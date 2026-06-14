const path = require('path');
const { DEFAULT_AMAP_KEY } = require('./constants');
const { scrapeCtripHotel } = require('./ctrip-scraper');
const { getCompareAppStorePath } = require('./compare-app-bridge');
const { buildPageSnapshotSummary } = require('./cli/run-summary');
const { getTransitInfo } = require('./amap');
const { buildHotelRecord, buildEligibleRoomRecords } = require('./hotel-record');
const {
  cleanupOutputArtifacts,
  sanitizeSensitiveData,
  slugify,
  writeJsonFile
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

class SingleDetailRunner {
  async run(context) {
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
      pageIndex = null,
      reportLevel = 'normal',
      isBatchItem = false,
      captureStrategy: contextCaptureStrategy = null,
      edgeParallelCancelPolicy: contextEdgeParallelCancelPolicy = null,
      scrapeEventForwarder = emit
    } = context;
    const reportDisabled = isReportDisabled(reportLevel);
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
      captureStrategy: args.captureStrategy || args['capture-strategy'] || contextCaptureStrategy,
      edgeParallelCancelPolicy:
        args.edgeParallelCancelPolicy ||
        args['edge-parallel-cancel-policy'] ||
        contextEdgeParallelCancelPolicy ||
        'none',
      onEvent: scrapeEventForwarder,
      perf: itemPerf.child({ url: itemTemplate.ctrip_url }),
      signal
    });
    performance.scrapeMs = durationSince(scrapeStartedAt);
    performance.scrape = scraped.performance || null;

    assertNotCancelled(signal);
    const hasEligibleScrapedRooms =
      Array.isArray(scraped.eligible_rooms) && scraped.eligible_rooms.length > 0;
    const skipTransitBecauseNoEligibleRooms = Boolean(isBatchItem && !hasEligibleScrapedRooms);
    const skipTransit = Boolean(
      args.skipTransit || args['skip-transit'] || skipTransitBecauseNoEligibleRooms
    );
    let transit = null;
    if (!skipTransit) {
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
      if (skipTransitBecauseNoEligibleRooms) {
        performance.transitSkippedReason = 'no_eligible_rooms';
        itemPerf.event('transit_skipped', {
          reason: 'no_eligible_rooms',
          eligible_count: 0,
          url: itemTemplate.ctrip_url
        });
      }
    }

    const { eligibleRoomRecords, hotelRecord, eligibleRoomSummaries } = await itemPerf.runPhase(
      'parse_data',
      { url: itemTemplate.ctrip_url },
      async () => {
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
        return {
          eligibleRoomRecords: nextEligibleRoomRecords,
          hotelRecord: nextHotelRecord,
          eligibleRoomSummaries: nextEligibleRoomSummaries
        };
      }
    );

    const outputPath = reportDisabled
      ? ''
      : path.resolve(
          preferredOutputPath ||
            path.join(outputDir, `${slugify(hotelRecord.name || 'hotel')}.json`)
        );
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
    if (writeAppData) {
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
            hotel: hotelRecord,
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
      const measure = writeJsonFile(outputPath, outputPayload, {
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
      roomType: hotelRecord.room_type,
      roomOccupancy: scraped.room ? (scraped.room.occupancy ?? null) : null,
      roomPrices: scraped.room && Array.isArray(scraped.room.prices) ? scraped.room.prices : [],
      totalPrice: hotelRecord.total_price,
      ctripScore: hotelRecord.ctrip_score,
      distance: hotelRecord.distance,
      subwayDistance: hotelRecord.subway_distance,
      transportTime: hotelRecord.transport_time,
      busRoute: hotelRecord.bus_route,
      pageSnapshot: buildPageSnapshotSummary(scraped.page_snapshot),
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
}

async function runPreparedSingleDetailImport(context) {
  return new SingleDetailRunner().run(context);
}

module.exports = {
  SingleDetailRunner,
  runPreparedSingleDetailImport
};
