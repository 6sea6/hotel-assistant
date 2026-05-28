/**
 * app.js — 应用入口模块
 *
 * 职责：
 *  1. 导入所有功能模块
 *  2. 统一绑定 DOM 事件和页面动作
 *  3. 绑定 DOM 事件和装载全局错误捕获
 *  4. 在 DOMContentLoaded 时执行 initializeApp
 *
 * 原始 3500+ 行代码已按职责拆分为 modules/ 下的独立文件，
 * 每个文件可独立阅读、测试和修改。
 */

/* ============ 模块导入 ============ */

import { state, setHotels, setTemplates, setSettings, setInitialized } from './modules/state.js';
import { $, addEvent } from './modules/dom-helpers.js';

import {
  loadHotels,
  loadTemplates,
  loadSettings,
  openAddHotelModal,
  closeHotelModal,
  saveHotel,
  confirmBatchDelete,
  applyTemplateToForm,
  onCheckInChange,
  onCheckOutChange,
  calculateDailyPrice,
  calculateTotalPrice,
  onDaysChange,
  validateScore,
  formatScoreOnBlur
} from './modules/hotel-crud.js';

import {
  renderHotelList,
  handleHotelListClick,
  handleHotelListChange,
  handleHotelDetailsClick,
  closeHotelDetails,
  toggleViewMode,
  openRuleDeleteModal,
  closeRuleDeleteModal,
  updateRuleDeletePreview,
  confirmRuleDelete,
  applyFilters,
  clearFilters
} from './modules/hotel-list.js';

import {
  openTemplateManager,
  closeTemplateModal,
  handleTemplateListClick,
  openAddTemplateForm,
  cancelTemplateForm,
  saveTemplate,
  updateTemplateFilter,
  setupTemplateSyncListener
} from './modules/template-ui.js';

import {
  openSettings,
  closeSettingsModal,
  openPersonalization,
  closePersonalizationModal,
  applySettings,
  changeTheme,
  toggleIncludeFourPersonRoomsForThreePersonTemplate,
  toggleEnableCollectPerfLog,
  saveCollectBatchConcurrencySetting,
  saveAmapApiKeySetting,
  saveAiListPrefilterSetting,
  openListPrefilterSettings,
  closeListPrefilterSettings,
  saveAiListPrefilterSettings,
  resetAiListPrefilterSettings,
  toggleAiCtripStarLevel,
  showDataInFolder,
  changeDataPath,
  chooseAppIcon,
  resetAppIcon,
  resetSettings,
  openDataTransfer,
  closeDataTransfer,
  handleExportData,
  handleImportData,
  openCtripWebsite,
  openFliggyWebsite,
  refreshCurrentPage,
  setupMenuListeners
} from './modules/settings-ui.js';
import {
  initializeWindowControls,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow
} from './modules/window-controls.js';

import {
  openAiAssistant,
  closeAiAssistant,
  enqueueAiCollectTask,
  enqueueRefreshHotelDataTask,
  cancelAiTask,
  clearAiTaskRecords,
  clearAiTaskQueue,
  selectAiQueueTask,
  removeAiQueueTask,
  retryAiQueueTask,
  rerunCurrentAiTask,
  handleAiTaskInputKeydown,
  showAiTaskDetails,
  focusAiTaskStartBar,
  handleAiTaskInputChange,
  syncAiCtripListUrlFromSettings
} from './modules/ai-assistant.js';

import { exportRankingImage } from './modules/ranking-image.js';
import { setupCustomSelects, refreshCustomSelects } from './modules/custom-select.js';

import {
  applyAppMetadata,
  openAbout,
  closeAbout,
  checkAndShowManual,
  openManual,
  closeManual
} from './modules/about-manual.js';

/* ============ 全局错误捕获 ============ */

window.addEventListener('error', (event) => {
  console.error('[全局错误]', event.error);
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Promise错误]', event.reason);
  event.preventDefault();
});

/* ============ 统一页面动作绑定 ============ */

/**
 * @typedef {(event: MouseEvent, element: HTMLElement) => void|Promise<void>} ActionHandler
 */

/** @type {Record<string, ActionHandler>} */
const ACTION_HANDLERS = {
  'open-ai-assistant': () => openAiAssistant(),
  'open-template-manager': () => openTemplateManager(),
  'open-data-transfer': () => openDataTransfer(),
  'open-personalization': () => openPersonalization(),
  'open-settings': () => openSettings(),
  'open-list-prefilter-settings': () => openListPrefilterSettings(),
  'open-about': () => openAbout(),
  'window-minimize': () => minimizeWindow(),
  'window-toggle-maximize': () => toggleMaximizeWindow(),
  'window-close': () => closeWindow(),
  'clear-filters': () => clearFilters(),
  'open-add-hotel': () => openAddHotelModal(),
  'export-ranking-image': () => exportRankingImage(),
  'toggle-view-mode': () => toggleViewMode(),
  'refresh-current-page': () => refreshCurrentPage(),
  'open-rule-delete': () => openRuleDeleteModal(),
  'confirm-batch-delete': () => confirmBatchDelete(),
  'close-hotel-modal': () => closeHotelModal(),
  'save-hotel': () => saveHotel(),
  'close-rule-delete': () => closeRuleDeleteModal(),
  'confirm-rule-delete': () => confirmRuleDelete(),
  'close-template-modal': () => closeTemplateModal(),
  'open-add-template-form': () => openAddTemplateForm(),
  'cancel-template-form': () => cancelTemplateForm(),
  'save-template': () => saveTemplate(),
  'close-settings': () => closeSettingsModal(),
  'close-list-prefilter-settings': () => closeListPrefilterSettings(),
  'show-data-folder': () => showDataInFolder(),
  'change-data-path': (event) => changeDataPath(event),
  'save-amap-api-key': () => saveAmapApiKeySetting(),
  'open-ctrip': () => openCtripWebsite(),
  'open-fliggy': () => openFliggyWebsite(),
  'open-manual': () => openManual(),
  'reset-settings': (event) => resetSettings(event),
  'save-list-prefilter-settings': async () => {
    const saved = await saveAiListPrefilterSettings();
    if (saved) {
      await syncAiCtripListUrlFromSettings();
    }
  },
  'reset-list-prefilter-settings': async () => {
    const saved = await resetAiListPrefilterSettings();
    if (saved) {
      await syncAiCtripListUrlFromSettings();
    }
  },
  'toggle-ai-ctrip-star': async (_event, element) => {
    const saved = await toggleAiCtripStarLevel(element.dataset.starLevel);
    if (saved) {
      await syncAiCtripListUrlFromSettings();
    }
  },
  'close-personalization': () => closePersonalizationModal(),
  'choose-app-icon': () => chooseAppIcon(),
  'reset-app-icon': () => resetAppIcon(),
  'close-hotel-details': () => closeHotelDetails(),
  'close-data-transfer': () => closeDataTransfer(),
  'export-data': () => handleExportData(),
  'import-data': (_event, element) => handleImportData(element.dataset.importMode),
  'close-about': () => closeAbout(),
  'close-manual': () => closeManual(),
  'clear-ai-task-records': () => clearAiTaskRecords(),
  'clear-ai-task-queue': () => clearAiTaskQueue(),
  'close-ai-assistant': () => closeAiAssistant(),
  'enqueue-ai-collect-task': () => enqueueAiCollectTask(),
  'refresh-all-hotel-data': () => enqueueRefreshHotelDataTask(),
  'cancel-ai-task': () => cancelAiTask(),
  'select-ai-queue-task': (_event, element) => selectAiQueueTask(element.dataset.taskId),
  'retry-ai-queue-task': (_event, element) => retryAiQueueTask(element.dataset.taskId),
  'remove-ai-queue-task': (_event, element) => removeAiQueueTask(element.dataset.taskId),
  'rerun-current-ai-task': () => rerunCurrentAiTask(),
  'show-ai-task-details': () => showAiTaskDetails(),
  'focus-ai-task-start-bar': () => focusAiTaskStartBar()
};

/**
 * @param {MouseEvent} event
 */
function handleActionClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const actionElement = /** @type {HTMLElement|null} */ (target?.closest('[data-action]') || null);
  if (!actionElement) return;

  const handler = ACTION_HANDLERS[actionElement.dataset.action || ''];
  if (!handler) return;

  event.preventDefault();
  handler(event, actionElement);
}

/* ============ DOM 事件绑定 ============ */

/**
 * @param {KeyboardEvent} e
 */
function handleGlobalKeydown(e) {
  if (e.key !== 'Escape') return;

  /** @type {Array<[string, () => void]>} */
  const closers = [
    ['hotelDetailsModal', closeHotelDetails],
    ['ruleDeleteModal', closeRuleDeleteModal],
    ['hotelModal', closeHotelModal],
    ['templateModal', closeTemplateModal],
    ['dataTransferModal', closeDataTransfer],
    ['manualModal', closeManual],
    ['personalizationModal', closePersonalizationModal],
    ['listPrefilterModal', closeListPrefilterSettings],
    ['settingsModal', closeSettingsModal],
    ['aboutModal', closeAbout]
  ];

  for (const [id, closeFn] of closers) {
    const el = $(id);
    if (el && el.classList.contains('active')) {
      closeFn();
      break;
    }
  }
}

function setupStaticFormListeners() {
  if (state.staticFormEventsBound) return;

  document.querySelectorAll('input[name="sortMode"]').forEach((input) => {
    input.addEventListener('change', applyFilters);
  });

  document.querySelectorAll('input[name="themeOption"]').forEach((input) => {
    const themeInput = /** @type {HTMLInputElement} */ (input);
    input.addEventListener('change', () => changeTheme(themeInput.value));
  });

  addEvent('aiHotelUrlInput', 'input', handleAiTaskInputChange);
  addEvent('aiHotelUrlInput', 'keydown', handleAiTaskInputKeydown);
  addEvent('hotelTemplateSelect', 'change', applyTemplateToForm);
  addEvent('totalPrice', 'input', calculateDailyPrice);
  addEvent('dailyPrice', 'input', calculateTotalPrice);
  addEvent('checkInDate', 'change', onCheckInChange);
  addEvent('checkOutDate', 'change', onCheckOutChange);
  addEvent('days', 'input', onDaysChange);
  addEvent('ctripScore', 'input', (event) => {
    if (event.target instanceof HTMLInputElement) validateScore(event.target);
  });
  addEvent('ctripScore', 'blur', (event) => {
    if (event.target instanceof HTMLInputElement) formatScoreOnBlur(event.target);
  });
  addEvent('ruleDeletePrice', 'input', updateRuleDeletePreview);
  addEvent('ruleDeleteSubwayDistance', 'input', updateRuleDeletePreview);
  addEvent('ruleDeleteTransportTime', 'input', updateRuleDeletePreview);
  addEvent(
    'includeFourPersonRoomsForThreePersonTemplate',
    'change',
    toggleIncludeFourPersonRoomsForThreePersonTemplate
  );
  addEvent('enableCollectPerfLog', 'change', toggleEnableCollectPerfLog);
  addEvent('collectBatchConcurrency', 'change', saveCollectBatchConcurrencySetting);
  [
    'aiCtripPriceMin',
    'aiCtripPriceMax',
    'aiCtripSortMode',
    'aiCtripFreeCancel',
    'aiCtripReviewCountMin',
    'aiCtripScoreMin',
    'aiListDesiredHotelCount',
    'aiListExcludeHotelTypes'
  ].forEach((id) =>
    addEvent(id, 'change', async (event) => {
      await saveAiListPrefilterSetting(event);
      if (id.startsWith('aiCtrip')) {
        await syncAiCtripListUrlFromSettings();
      }
    })
  );

  state.staticFormEventsBound = true;
}

function setupEventListeners() {
  if (!state.globalActionEventsBound) {
    document.addEventListener('click', handleActionClick);
    state.globalActionEventsBound = true;
  }

  if (!state.globalKeyEventsBound) {
    document.addEventListener('keydown', handleGlobalKeydown);
    state.globalKeyEventsBound = true;
  }

  if (!state.hotelListEventsBound) {
    const hotelList = $('hotelList');
    if (hotelList) {
      hotelList.addEventListener('click', handleHotelListClick);
      hotelList.addEventListener('change', handleHotelListChange);
      state.hotelListEventsBound = true;
    }
  }

  if (!state.templateListEventsBound) {
    const templateList = $('templateList');
    if (templateList) {
      templateList.addEventListener('click', handleTemplateListClick);
      state.templateListEventsBound = true;
    }
  }

  if (!state.hotelDetailsEventsBound) {
    const hotelDetailsContent = $('hotelDetailsContent');
    if (hotelDetailsContent) {
      hotelDetailsContent.addEventListener('click', handleHotelDetailsClick);
      state.hotelDetailsEventsBound = true;
    }
  }

  addEvent('filterName', 'change', applyFilters);
  addEvent('filterScore', 'change', applyFilters);
  addEvent('filterFavorite', 'change', applyFilters);
  addEvent('filterTemplate', 'change', applyFilters);
  addEvent('filterTransportTime', 'change', applyFilters);
  addEvent('filterSubwayDistance', 'change', applyFilters);
  setupStaticFormListeners();
}

/* ============ 初始化 ============ */

async function initializeApp() {
  if (state.isInitialized) return;

  console.log('[初始化] 开始初始化应用...');

  try {
    const [loadedSettings, loadedHotels, loadedTemplates] = await Promise.all([
      loadSettings(),
      loadHotels(),
      loadTemplates()
    ]);

    console.log('[初始化] 数据加载完成:', {
      settings: loadedSettings,
      hotelsCount: loadedHotels ? loadedHotels.length : 0,
      templatesCount: loadedTemplates ? loadedTemplates.length : 0
    });

    setSettings(loadedSettings || {});
    setHotels(loadedHotels || []);
    setTemplates(loadedTemplates || []);
    await initializeWindowControls();

    requestAnimationFrame(() => {
      console.log('[初始化] 开始渲染界面...');
      applyAppMetadata();
      applySettings();
      updateTemplateFilter();
      renderHotelList();
      setupEventListeners();
      setupMenuListeners();
      setupTemplateSyncListener();
      setupCustomSelects(document, { auto: true });
      refreshCustomSelects(document, { auto: true });
      checkAndShowManual();
      console.log('[初始化] 界面渲染完成');
    });

    setInitialized(true);
    console.log('[初始化] 应用初始化完成');
  } catch (error) {
    console.error('[初始化] 初始化失败:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => initializeApp());
