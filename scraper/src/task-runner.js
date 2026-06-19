const path = require('path');
const { requireSharedCompareAppModule } = require('./compare-app/shared-module');
const { BASE_COMPARE_APP_SETTINGS } = requireSharedCompareAppModule('constants.js');
const { findTemplateInStore, loadCompareAppStore } = require('./compare-app-bridge');
const {
  describeExpandedInput,
  expandCtripHotelInputs,
  normalizeListFiltersFromArgs
} = require('./ctrip-list');
const { classifyCtripHotelUrl, extractCtripUrlsFromInput } = require('./ctrip-url');
const {
  closeAutoEdge,
  hasReusableEdgeProfile,
  launchAndWaitForEdge,
  resolveAutoEdgeRuntime,
  runInteractiveEdgeLoginPrep
} = require('./cli/auto-edge');
const { applyReviewedOutput } = require('./cli/reviewed-output');
const {
  DEFAULT_LATEST_RUN_PATH,
  buildRunSummary,
  writeLatestRunFile
} = require('./cli/run-summary');
const { resolveCtripListUrlFromAddress } = require('./scraper/list-page-address-search');
const {
  applyMatchedTemplate,
  loadTemplate,
  mergeTemplateWithArgs,
  validateTemplate
} = require('./template-loader');
const {
  ensureDir,
  normalizePlaceName,
  normalizeReportLevel,
  normalizeText,
  readJsonFile
} = require('./utils');
const { setup_perf_logger, PerfTimer } = require('./runtime/perf');
const {
  assertNotCancelled,
  buildEdgeSessionOptions,
  buildTemplateSnapshot,
  normalizeBatchConcurrency,
  normalizeTaskArgs,
  withWorkingDirectory
} = require('./task-context');
const { createScrapeEventForwarder, createTaskEmitter } = require('./task-events');
const { runPreparedSingleDetailImport } = require('./single-detail-runner');
const { runBatchHotelImportTask } = require('./batch-orchestrator');
const {
  cleanupBatchEdgeWorkerProfileClones,
  prepareBatchEdgeWorkerProfileClones
} = require('./batch-edge-worker-pool');
const { buildBatchOutputPayload } = require('./batch-result-builder');

const MAX_AUTO_EDGE_PREPARED_WORKERS = 3;

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

function logListCandidateFilterDiagnostics(perf, expandedInputs = {}) {
  if (!perf || typeof perf.event !== 'function' || !Array.isArray(expandedInputs.listResults)) {
    return;
  }

  perf.event('list_filter_summary', {
    phase: 'list_filter',
    input_mode: expandedInputs.inputMode || '',
    list_count: expandedInputs.listResults.length,
    ctrip_url_filter_settings:
      expandedInputs.summary && expandedInputs.summary.ctripUrlFilterSettings
        ? expandedInputs.summary.ctripUrlFilterSettings
        : null,
    list_performance:
      expandedInputs.summary &&
      expandedInputs.summary.performance &&
      Array.isArray(expandedInputs.summary.performance.lists)
        ? expandedInputs.summary.performance.lists.map((item) => ({
            selectedCount: item.selectedCount,
            totalCandidates: item.totalCandidates,
            edgeFallbackUsed: item.edgeFallbackUsed,
            effectiveListFilters: item.effectiveListFilters || '',
            htmlPages:
              item.collector && Array.isArray(item.collector.htmlPages)
                ? item.collector.htmlPages.map((page) => page.candidateCount)
                : [],
            staticApiPages:
              item.collector && Array.isArray(item.collector.staticApiPages)
                ? item.collector.staticApiPages.map((page) => ({
                    candidateCount: page.candidateCount,
                    listApiResponseCount: page.listApiResponseCount,
                    listApiPageIndexes: page.listApiPageIndexes,
                    listApiError: page.listApiError || ''
                  }))
                : [],
            edgePages:
              item.collector && Array.isArray(item.collector.edgePages)
                ? item.collector.edgePages.map((page) => ({
                    candidateCount: page.candidateCount,
                    candidateDomCount: page.candidateDomCount,
                    networkResponseCount: page.networkResponseCount,
                    listApiResponseCount: page.listApiResponseCount,
                    listApiError: page.listApiError || ''
                  }))
                : []
          }))
        : []
  });

  let emitted = 0;
  const maxEvents = 300;
  expandedInputs.listResults.forEach((listResult, listIndex) => {
    const candidates = [
      ...(Array.isArray(listResult.selected)
        ? listResult.selected.map((candidate) => ({ candidate, selected: true }))
        : []),
      ...(Array.isArray(listResult.rejected)
        ? listResult.rejected.map((candidate) => ({ candidate, selected: false }))
        : [])
    ];
    candidates.forEach(({ candidate, selected }, candidateIndex) => {
      if (emitted >= maxEvents) {
        return;
      }
      emitted += 1;
      const rejectReason = candidate.rejectReason || '';
      perf.event('list_candidate_filter', {
        phase: 'list_filter',
        list_index: listIndex + 1,
        candidate_index: candidateIndex + 1,
        selected,
        reject_reason: rejectReason,
        hotel_id: candidate.hotelId || '',
        hotel_name: candidate.hotelName || candidate.name || '',
        hotel_type: candidate.hotelType || '',
        hotel_tags: [
          ...(Array.isArray(candidate.badges) ? candidate.badges : []),
          ...(Array.isArray(candidate.visibleTags) ? candidate.visibleTags : [])
        ].join('|'),
        source: candidate.source || ''
      });
    });
  });
}

function normalizePositiveInteger(value, fallback = null) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return fallback;
  }

  return Math.max(1, Math.trunc(numberValue));
}

function summarizeKnownCtripInputUrls(args = {}, template = {}) {
  if (normalizeText(args.addressQuery || args['address-query'])) {
    return {
      urlCount: 0,
      detailCount: 0,
      listCount: 0
    };
  }
  const inputUrls = extractCtripUrlsFromInput({
    ...args,
    url: args.url || args.ctrip_url || args['ctrip-url'] || template.ctrip_url
  });
  const urls = inputUrls.length ? inputUrls : template.ctrip_url ? [template.ctrip_url] : [];
  const summary = {
    urlCount: urls.length,
    detailCount: 0,
    listCount: 0
  };

  for (const url of urls) {
    const classification = classifyCtripHotelUrl(url);
    if (classification.type === 'detail') {
      summary.detailCount += 1;
    } else if (classification.type === 'list') {
      summary.listCount += 1;
    }
  }

  return summary;
}

function getAddressQueryFromArgs(args = {}) {
  return normalizeText(args.addressQuery || args['address-query']);
}

function resolvePreparedEdgeWorkerConcurrency(
  args = {},
  options = {},
  template = {},
  listFilters = {}
) {
  const requestedConcurrency = normalizeBatchConcurrency(args, options);
  if (requestedConcurrency <= 1) {
    return 1;
  }

  const optionMaxConcurrency = normalizePositiveInteger(options.maxConcurrency);
  const maxPreparedWorkers = optionMaxConcurrency
    ? Math.min(optionMaxConcurrency, MAX_AUTO_EDGE_PREPARED_WORKERS)
    : MAX_AUTO_EDGE_PREPARED_WORKERS;
  let preparedConcurrency = Math.min(requestedConcurrency, maxPreparedWorkers);
  const inputSummary = summarizeKnownCtripInputUrls(args, template);

  if (inputSummary.urlCount > 0 && inputSummary.listCount <= 0) {
    preparedConcurrency = Math.min(preparedConcurrency, inputSummary.detailCount);
  } else if (inputSummary.listCount > 0) {
    const targetCount = normalizePositiveInteger(
      listFilters.desiredHotelCount || listFilters.targetCount,
      0
    );
    const estimatedExpandedCount = inputSummary.detailCount + targetCount;
    if (estimatedExpandedCount > 0) {
      preparedConcurrency = Math.min(preparedConcurrency, estimatedExpandedCount);
    }
  }

  return Math.max(1, preparedConcurrency);
}

function buildListTargetShortfallWarning(expandedInputs = {}) {
  const summary = expandedInputs.summary || {};
  const filters = summary.filters || {};
  const listInputCount = normalizePositiveInteger(summary.listInputCount, 0);
  const desiredCount = normalizePositiveInteger(
    filters.desiredHotelCount || filters.targetCount,
    0
  );
  if (!listInputCount || !desiredCount) {
    return null;
  }

  const expandedCount = normalizePositiveInteger(
    summary.expandedHotelCount ??
      (Array.isArray(expandedInputs.hotelInputs) ? expandedInputs.hotelInputs.length : 0),
    0
  );
  if (expandedCount >= desiredCount) {
    return null;
  }

  const listErrors = Array.isArray(expandedInputs.listResults)
    ? expandedInputs.listResults
        .flatMap((item) => (Array.isArray(item.errors) ? item.errors : []))
        .map((item) => item.error)
        .filter(Boolean)
    : [];
  const errorSuffix = listErrors.length ? `；列表采集错误：${listErrors.join('; ')}` : '';
  const message = `携程列表页只展开 ${expandedCount}/${desiredCount} 家目标宾馆，未达到目标数量；本次将继续采集已确认候选，请稍后可重试或放宽列表页前筛条件${errorSuffix}`;
  return {
    type: 'list_target_shortfall',
    message,
    expandedCount,
    desiredCount,
    listErrors
  };
}

function buildEmptyListResult({
  args = {},
  startedAt,
  latestRunPath,
  template = {},
  matchedTemplate = null,
  effectiveTemplate = {},
  expandedInputs = {},
  reportLevel = 'normal'
}) {
  const finishedAt = new Date().toISOString();
  const summary = expandedInputs.summary || {};
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  const emptyReason = '未筛选到宾馆，请放宽列表页前筛条件后重试。';
  const requestedUrls = Array.isArray(expandedInputs.requestedUrls)
    ? expandedInputs.requestedUrls
    : [];
  const batchSummary = {
    ...summary,
    inputMode: summary.inputMode || expandedInputs.inputMode || 'list',
    requestedUrlCount: summary.requestedUrlCount ?? requestedUrls.length,
    expandedHotelCount: 0,
    succeededCount: 0,
    failedCount: 0,
    eligibleHotelRecordCount: 0,
    emptyReason,
    warnings: warnings.includes(emptyReason) ? warnings : [...warnings, emptyReason]
  };

  return {
    success: true,
    startedAt,
    finishedAt,
    latestRunPath,
    outputPath: '',
    compareAppStorePath: '',
    templateName:
      effectiveTemplate.template_name ||
      effectiveTemplate.name ||
      template.template_name ||
      args.templateName ||
      '',
    templateId:
      effectiveTemplate.template_id ||
      effectiveTemplate.id ||
      template.template_id ||
      args.templateId ||
      null,
    templateSnapshot: buildTemplateSnapshot(
      effectiveTemplate && Object.keys(effectiveTemplate).length ? effectiveTemplate : template,
      matchedTemplate ? 'matched' : 'effective'
    ),
    requestedUrl: args.url || args.ctrip_url || args['ctrip-url'] || '',
    requestedUrls,
    resolvedUrl: '',
    resolvedUrls: [],
    inputMode: expandedInputs.inputMode || 'list',
    batchMode: true,
    items: [],
    batchStats: batchSummary,
    batchSummary,
    hotelName: '未筛选到宾馆',
    eligibleCount: 0,
    eligibleRoomTypes: [],
    eligibleHotels: [],
    totalPrice: null,
    writeSkipped: true,
    writeSkipReason: emptyReason,
    writeResult: null,
    error: null,
    emptyListResult: true,
    emptyReason,
    reportLevel
  };
}

async function runHotelImportTask(rawArgs = {}, options = {}) {
  const args = normalizeTaskArgs(rawArgs);
  const startedAt = options.startedAt || new Date().toISOString();
  const taskId = options.taskId || args.taskId || `task-${Date.now()}`;
  const emit = createTaskEmitter(options.onEvent);
  const scrapeEventForwarder = createScrapeEventForwarder(emit);
  const signal = options.signal || null;
  const latestRunPathInput = args.latestRun || DEFAULT_LATEST_RUN_PATH;
  const perfLogger =
    options.perfLogger ||
    setup_perf_logger({
      enabled: Boolean(options.perfLogEnabled),
      logDir: options.perfLogDir
    });
  const taskKind = args['apply-output'] ? 'apply_output' : 'collect';
  const requestedReportLevel =
    args['skip-report'] || args['no-output-report']
      ? 'off'
      : args.reportLevel || args['report-level'] || options.reportLevel || 'normal';
  const reportLevel = normalizeReportLevel(
    args['apply-output'] && requestedReportLevel === 'off' ? 'normal' : requestedReportLevel
  );
  const perf =
    options.perf ||
    new PerfTimer(perfLogger, {
      runId: options.runId || args.runId || taskId,
      taskId,
      taskKind,
      mode: taskKind,
      city: args.city || args.destination || args.templateName || '',
      url: args.url || args.ctrip_url || args['ctrip-url'] || ''
    });

  if (!options.scriptStartLogged) {
    perf.event('script_start', {
      phase: 'script_start',
      status: 'success',
      elapsed_ms: 0,
      taskId,
      taskKind
    });
  }

  return perf.runPhase('task_total', { taskId, taskKind }, async () =>
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
          readJsonFile(latestRunPath, {
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
        validateTemplate(loadedEffectiveTemplate, {
          requireCtripUrl: !getAddressQueryFromArgs(args)
        });
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

      const listFilters = normalizeListFiltersFromArgs(args);
      let autoEdgeProcess = null;
      let autoEdgePid = null;
      let preparedEdgeWorkerProfileDirs = [];
      const autoEdge = Boolean(args['auto-edge']);
      const autoEdgeRuntime = autoEdge
        ? resolveAutoEdgeRuntime({
            userDataDir: effectiveTemplate.edge_user_data_dir,
            profileDirectory: effectiveTemplate.edge_profile_directory,
            browserPreference: effectiveTemplate.browser_preference
          })
        : null;

      try {
        assertNotCancelled(signal);
        if (autoEdge) {
          if (autoEdgeRuntime && autoEdgeRuntime.userDataDir) {
            effectiveTemplate.edge_user_data_dir = autoEdgeRuntime.userDataDir;
            effectiveTemplate.edge_profile_directory = autoEdgeRuntime.profileDirectory;
          }
          emit('edge:start', '正在准备浏览器登录态');
          await perf.runPhase('browser_context', { taskId, taskKind: 'login_prep' }, async () => {
            if (
              !hasReusableEdgeProfile(
                effectiveTemplate.edge_user_data_dir,
                effectiveTemplate.edge_profile_directory
              )
            ) {
              emit('edge:login-required', '首次采集需要登录携程后继续', {
                reason: '未检测到可复用的携程登录资料。',
                instruction:
                  '程序会打开一个可见浏览器窗口。请在窗口中登录携程，确认酒店页能看到价格后关闭该窗口，当前采集任务会自动继续。'
              });
              const loginPrepResult = await runInteractiveEdgeLoginPrep({
                userDataDir: effectiveTemplate.edge_user_data_dir,
                profileDirectory: effectiveTemplate.edge_profile_directory,
                browserPreference: effectiveTemplate.browser_preference,
                port: effectiveTemplate.edge_debugging_port || 9222,
                url: effectiveTemplate.ctrip_url || 'https://hotels.ctrip.com/'
              });
              if (loginPrepResult && loginPrepResult.loginConfirmed) {
                emit('edge:login-done', '携程登录窗口已关闭，继续后台采集');
              } else {
                emit('edge:login-unconfirmed', '携程登录窗口已关闭，但尚未确认登录态', {
                  instruction: '请重新执行采集，并在弹出的浏览器窗口中完成携程登录后再关闭窗口。'
                });
              }
            }
          });

          const edgeResult = await perf.runPhase('browser_launch', { taskId }, async () => {
            const preparedWorkerConcurrency = resolvePreparedEdgeWorkerConcurrency(
              args,
              options,
              effectiveTemplate,
              listFilters
            );
            if (preparedWorkerConcurrency > 1) {
              preparedEdgeWorkerProfileDirs = prepareBatchEdgeWorkerProfileClones({
                effectiveTemplate,
                concurrency: preparedWorkerConcurrency,
                existingWorkerCount: 1
              });
            }
            return launchAndWaitForEdge({
              userDataDir: effectiveTemplate.edge_user_data_dir,
              profileDirectory: effectiveTemplate.edge_profile_directory,
              browserPreference: effectiveTemplate.browser_preference,
              port: effectiveTemplate.edge_debugging_port || 9222,
              url: 'about:blank',
              headless: effectiveTemplate.edge_headless
            });
          });
          autoEdgeProcess = edgeResult;
          autoEdgePid = edgeResult.pid;
          if (!effectiveTemplate.edge_debugging_port) {
            effectiveTemplate.edge_debugging_port = edgeResult.port;
          }
        }

        assertNotCancelled(signal);
        const addressQuery = getAddressQueryFromArgs(args);
        if (args.inputMode === 'address' && !addressQuery) {
          throw new Error('请输入地址或目的地。');
        }
        if (addressQuery) {
          emit('address-search:start', `正在用地址搜索携程列表页：${addressQuery}`);
          const resolvedAddressUrl = await perf.runPhase('address_search', { taskId }, async () =>
            resolveCtripListUrlFromAddress(addressQuery, effectiveTemplate, {
              edgeSession: buildEdgeSessionOptions(effectiveTemplate),
              signal
            })
          );
          args.url = resolvedAddressUrl;
          args.urls = '';
          args.text = '';
          args.inputText = '';
          effectiveTemplate.ctrip_url = resolvedAddressUrl;
          emit('address-search:done', '地址已解析为携程列表页，继续执行前筛与采集', {
            addressQuery,
            resolvedUrl: resolvedAddressUrl
          });
        }

        emit('list:start', '正在解析携程链接与列表页候选', {
          desiredHotelCount: listFilters.desiredHotelCount,
          targetCount: listFilters.targetCount,
          maxCandidatesPerPage: listFilters.maxCandidatesPerPage
        });
        const expandedInputs = await perf.runPhase('build_url', { taskId }, async () => {
          return expandCtripHotelInputs(args, effectiveTemplate, listFilters, {
            autoEdge,
            edgeSession: buildEdgeSessionOptions(effectiveTemplate)
          });
        });
        logListCandidateFilterDiagnostics(perf, expandedInputs);
        emit('list:done', '携程链接与列表页候选解析完成', {
          summary: describeExpandedInput(expandedInputs),
          inputMode: expandedInputs.inputMode,
          expandedHotelCount:
            expandedInputs.summary && expandedInputs.summary.expandedHotelCount !== undefined
              ? expandedInputs.summary.expandedHotelCount
              : expandedInputs.hotelInputs.length,
          listCandidateCount:
            expandedInputs.summary && expandedInputs.summary.listCandidateCount !== undefined
              ? expandedInputs.summary.listCandidateCount
              : 0,
          listRejectedCount:
            expandedInputs.summary && expandedInputs.summary.listRejectedCount !== undefined
              ? expandedInputs.summary.listRejectedCount
              : 0
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
            if (listErrors) {
              throw new Error(listErrors);
            }
            const result = buildEmptyListResult({
              args,
              startedAt,
              latestRunPath,
              template,
              matchedTemplate,
              effectiveTemplate,
              expandedInputs,
              reportLevel
            });
            emit('list:empty', result.emptyReason, {
              inputMode: expandedInputs.inputMode,
              expandedHotelCount: 0,
              listCandidateCount:
                listSummary.listCandidateCount !== undefined ? listSummary.listCandidateCount : 0,
              listRejectedCount:
                listSummary.listRejectedCount !== undefined ? listSummary.listRejectedCount : 0,
              emptyListResult: true
            });
            await perf.runPhase('write_latest_run', { taskId, hotelCount: 0 }, async () => {
              writeLatestRunFile(latestRunPath, buildRunSummary(result));
            });
            emit('task:done', result.emptyReason, {
              inputMode: result.inputMode,
              hotelCount: 0,
              eligibleCount: 0,
              failedCount: 0,
              wrote: false,
              emptyListResult: true
            });
            return result;
          }
          throw new Error(skippedReason || '未从输入中解析到可采集的携程酒店详情页或列表页 URL。');
        }
        const listShortfallWarning = buildListTargetShortfallWarning(expandedInputs);
        if (listShortfallWarning) {
          const previousSummary = expandedInputs.summary || {};
          const previousWarnings = Array.isArray(previousSummary.warnings)
            ? previousSummary.warnings
            : [];
          expandedInputs.summary = {
            ...previousSummary,
            listTargetShortfall: listShortfallWarning,
            warnings: [...previousWarnings, listShortfallWarning.message]
          };
          emit('list:warning', listShortfallWarning.message, {
            expandedHotelCount: listShortfallWarning.expandedCount,
            desiredHotelCount: listShortfallWarning.desiredCount,
            listErrors: listShortfallWarning.listErrors
          });
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
            perf,
            reportLevel,
            scrapeEventForwarder,
            preparedEdgeWorkerProfileDirs,
            existingEdgeWorker:
              autoEdge && autoEdgePid && normalizeBatchConcurrency(args, options) > 1
                ? {
                    pid: autoEdgePid,
                    port: effectiveTemplate.edge_debugging_port,
                    userDataDir: effectiveTemplate.edge_user_data_dir,
                    profileDirectory: effectiveTemplate.edge_profile_directory,
                    browserExecutable: autoEdgeProcess && autoEdgeProcess.browserExecutable,
                    browserName: autoEdgeProcess && autoEdgeProcess.browserName
                  }
                : null
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
          pageIndex: 1,
          reportLevel,
          captureStrategy: options.captureStrategy,
          edgeParallelCancelPolicy: options.edgeParallelCancelPolicy,
          scrapeEventForwarder
        });
        const result = preparedResult.result;

        await perf.runPhase(
          'write_latest_run',
          { taskId, hotelCount: result.eligibleCount },
          async () => {
            writeLatestRunFile(
              latestRunPath,
              buildRunSummary({
                ...result,
                eligibleHotels: result.eligibleHotels
              })
            );
          }
        );
        emit('task:done', '采集任务完成', {
          hotelName: result.hotelName,
          eligibleCount: result.eligibleCount,
          wrote: Boolean(result.writeResult)
        });
        return result;
      } finally {
        if (autoEdge && autoEdgePid) {
          await perf.runPhase('close_resource', { taskId }, async () => {
            closeAutoEdge(autoEdgePid, autoEdgeProcess);
          });
        }
        cleanupBatchEdgeWorkerProfileClones(preparedEdgeWorkerProfileDirs);
      }
    })
  );
}

module.exports = {
  buildBatchOutputPayload,
  buildFailureResult,
  buildTemplateSnapshot,
  runHotelImportTask,
  writeFailureSummary
};
