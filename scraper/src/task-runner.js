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
const { applyMatchedTemplate, loadTemplate, mergeTemplateWithArgs, validateTemplate } = require('./template-loader');
const {
  cleanupOutputArtifacts,
  ensureDir,
  normalizePlaceName,
  parseArgs,
  sanitizeSensitiveData,
  slugify,
  writeJsonFile
} = require('./utils');

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

async function runHotelImportTask(rawArgs = {}, options = {}) {
  const args = normalizeTaskArgs(rawArgs);
  const startedAt = options.startedAt || new Date().toISOString();
  const taskId = options.taskId || args.taskId || `task-${Date.now()}`;
  const emit = createTaskEmitter(options.onEvent);
  const signal = options.signal || null;
  const latestRunPathInput = args.latestRun || DEFAULT_LATEST_RUN_PATH;

  return withWorkingDirectory(options.workingDirectory, async () => {
    const latestRunPath = path.resolve(latestRunPathInput);
    assertNotCancelled(signal);

    if (args['apply-output']) {
      emit('apply:start', '正在回写已复核的采集结果');
      applyReviewedOutput(args['apply-output'], latestRunPath, startedAt, {
        overwriteExistingGroup: Boolean(args['overwrite-existing-group'])
      });
      emit('apply:done', '已完成回写');
      return buildRunSummary(require('./utils').readJsonFile(latestRunPath, {
        success: true,
        startedAt,
        finishedAt: new Date().toISOString()
      }));
    }

    if (args['write-app-data'] && !args['unsafe-allow-unreviewed-write']) {
      throw new Error('`--write-app-data` 已默认禁用。它会跳过最终房型复核并直接写入比较助手。只有在明确接受风险时，才同时传入 `--unsafe-allow-unreviewed-write`。');
    }

    emit('template:start', '正在读取模板与比较助手设置');
    const store = loadCompareAppStore();
    const compareAppSettings = {
      ...BASE_COMPARE_APP_SETTINGS,
      ...((store && store.settings) || {})
    };
    const templateFromFile = args.template ? loadTemplate(args.template) : {};
    const template = mergeTemplateWithArgs(templateFromFile, args);
    const matchedTemplate = findTemplateInStore(store, template.template_id, template.template_name || args.templateName);
    const effectiveTemplate = applyMatchedTemplate(template, matchedTemplate);
    validateTemplate(effectiveTemplate);

    const effectiveDestination = normalizePlaceName((matchedTemplate && matchedTemplate.destination) || effectiveTemplate.destination);
    const outputDir = path.resolve('output');
    ensureDir(outputDir);

    let autoEdgePid = null;
    const autoEdge = Boolean(args['auto-edge']);

    try {
      assertNotCancelled(signal);
      if (autoEdge) {
        emit('edge:start', '正在准备 Edge 登录态');
        if (!hasReusableEdgeProfile(effectiveTemplate.edge_user_data_dir, effectiveTemplate.edge_profile_directory)) {
          emit('edge:login-required', '首次采集需要登录携程后继续', {
            reason: '未检测到可复用的 Edge 携程登录资料。',
            instruction: '程序会打开一个可见 Edge 窗口。请在窗口中登录携程，确认酒店页能看到价格后关闭该窗口，当前采集任务会自动继续。'
          });
          await runInteractiveEdgeLoginPrep({
            userDataDir: effectiveTemplate.edge_user_data_dir,
            profileDirectory: effectiveTemplate.edge_profile_directory,
            port: effectiveTemplate.edge_debugging_port || 9222,
            url: effectiveTemplate.ctrip_url || 'https://hotels.ctrip.com/'
          });
          emit('edge:login-done', '携程登录窗口已关闭，继续后台采集');
        }

        const edgeResult = await launchAndWaitForEdge({
          userDataDir: effectiveTemplate.edge_user_data_dir,
          profileDirectory: effectiveTemplate.edge_profile_directory,
          port: effectiveTemplate.edge_debugging_port || 9222,
          url: 'about:blank',
          headless: effectiveTemplate.edge_headless
        });
        autoEdgePid = edgeResult.pid;
        if (!effectiveTemplate.edge_debugging_port) {
          effectiveTemplate.edge_debugging_port = edgeResult.port;
        }
      }

      assertNotCancelled(signal);
      emit('scrape:start', '正在采集携程酒店页面');
      const scraped = await scrapeCtripHotel(effectiveTemplate.ctrip_url, effectiveTemplate, {
        htmlPath: args.html,
        saveHtml: Boolean(args['save-html']),
        snapshotDir: path.join(outputDir, 'raw-pages'),
        matchingOptions: {
          includeFourPersonRoomsForThreePersonTemplate: Boolean(compareAppSettings.includeFourPersonRoomsForThreePersonTemplate)
        },
        edgeSession: {
          userDataDir: effectiveTemplate.edge_user_data_dir,
          profileDirectory: effectiveTemplate.edge_profile_directory,
          debuggerUrl: effectiveTemplate.edge_debugger_url,
          debuggingPort: effectiveTemplate.edge_debugging_port,
          headless: effectiveTemplate.edge_headless
        },
        autoEdge
      });

      assertNotCancelled(signal);
      emit('transit:start', '正在计算交通与地铁信息');
      const transit = await getTransitInfo(scraped.address, effectiveDestination, args.amapKey || DEFAULT_AMAP_KEY, {
        hotelGeo: scraped.geo
      });
      const eligibleRoomRecords = buildEligibleRoomRecords(effectiveTemplate, scraped, transit, matchedTemplate);
      const hotelRecord = eligibleRoomRecords[0] || buildHotelRecord(effectiveTemplate, scraped, transit, matchedTemplate);
      const eligibleRoomSummaries = eligibleRoomRecords.map((roomRecord, index) => {
        const sourceRoom = Array.isArray(scraped.eligible_rooms) ? (scraped.eligible_rooms[index] || {}) : {};
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

      const outputPath = path.resolve(args.out || path.join(outputDir, `${slugify(hotelRecord.name || 'hotel')}.json`));
      const reviewInput = buildReviewInput({
        taskMeta: {
          taskId,
          url: effectiveTemplate.ctrip_url,
          templateId: hotelRecord.template_id,
          templateName: effectiveTemplate.template_name,
          checkInDate: effectiveTemplate.check_in_date,
          checkOutDate: effectiveTemplate.check_out_date,
          roomCount: effectiveTemplate.room_count,
          guestCount: effectiveTemplate.room_count,
          destination: effectiveDestination
        },
        finalHotels: eligibleRoomRecords.length > 0 ? eligibleRoomRecords : [hotelRecord],
        roomCandidates: scraped.raw_room_candidates || scraped.room_candidates || [],
        evaluations: scraped.room_selection_diagnostics && Array.isArray(scraped.room_selection_diagnostics.evaluations)
          ? scraped.room_selection_diagnostics.evaluations
          : [],
        pageSnapshot: scraped.page_snapshot,
        template: effectiveTemplate
      });
      const outputPayload = sanitizeSensitiveData({
        hotels: eligibleRoomRecords,
        hotel: hotelRecord,
        review_input: reviewInput,
        compare_app_store: getCompareAppStorePath(),
        matched_template: matchedTemplate,
        effective_template: effectiveTemplate,
        compare_app_settings: compareAppSettings,
        scrape_debug: {
          requested_url: template.ctrip_url,
          resolved_url: effectiveTemplate.ctrip_url,
          selected_room: scraped.room,
          eligible_rooms: scraped.eligible_rooms,
          room_candidates: scraped.room_candidates,
          raw_room_candidates: scraped.raw_room_candidates,
          selection_logs: reviewInput.selectionLogs,
          rejected_room_types: reviewInput.rejectedRoomTypes,
          normalize_logs: reviewInput.normalizeLogs,
          page_snapshot: scraped.page_snapshot,
          transit
        }
      });

      writeJsonFile(outputPath, outputPayload);

      const cleanupResult = cleanupOutputArtifacts(outputDir, outputPath, scraped.page_snapshot && scraped.page_snapshot.saved_html_files);

      let writeResult = null;
      if (args['write-app-data']) {
        emit('write:start', '正在写入宾馆比较数据');
        if (shouldSkipHotelWrite(eligibleRoomRecords)) {
          writeResult = {
            storePath: getCompareAppStorePath(),
            operation: 'skipped',
            skippedCount: eligibleRoomRecords.length,
            reason: '所有候选房型都明确写了不可取消、不支持取消，或仅支持订单确认后短时间内免费取消；按当前规则整家跳过，未直写比较助手。'
          };
        } else {
          writeResult = appendHotelsToStore(eligibleRoomRecords, { replaceExistingGroup: true });
        }
      }

      const finishedAt = new Date().toISOString();
      const result = {
        success: true,
        startedAt,
        finishedAt,
        outputPath,
        compareAppStorePath: getCompareAppStorePath(),
        templateName: effectiveTemplate.template_name,
        templateId: hotelRecord.template_id,
        requestedUrl: template.ctrip_url,
        resolvedUrl: effectiveTemplate.ctrip_url,
        templateSnapshot: {
          matchedTemplate: buildTemplateSnapshot(matchedTemplate, matchedTemplate ? 'store.templates' : ''),
          effectiveTemplate: buildTemplateSnapshot(effectiveTemplate, 'effective-template')
        },
        hotelName: hotelRecord.name,
        eligibleCount: eligibleRoomRecords.length,
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
        reviewInput
      };

      writeLatestRunFile(latestRunPath, buildRunSummary({
        ...result,
        eligibleHotels: eligibleRoomRecords
      }));
      emit('task:done', '采集任务完成', {
        hotelName: result.hotelName,
        eligibleCount: result.eligibleCount,
        wrote: Boolean(writeResult)
      });
      return result;
    } finally {
      if (autoEdge && autoEdgePid) {
        closeAutoEdge(autoEdgePid);
      }
    }
  });
}

module.exports = {
  buildFailureResult,
  buildTemplateSnapshot,
  runHotelImportTask,
  writeFailureSummary
};
