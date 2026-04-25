/**
 * app.js — 应用入口模块
 *
 * 职责：
 *  1. 导入所有功能模块
 *  2. 将 HTML 内联事件处理器（onclick / onchange / oninput）暴露到 window
 *  3. 绑定 DOM 事件和装载全局错误捕获
 *  4. 在 DOMContentLoaded 时执行 initializeApp
 *
 * 原始 3500+ 行代码已按职责拆分为 modules/ 下的独立文件，
 * 每个文件可独立阅读、测试和修改。
 */

/* ============ 模块导入 ============ */

import { state, rankingCache } from './modules/state.js';
import { $, addEvent } from './modules/dom-helpers.js';
import { showNotification } from './modules/notification.js';
import { perfStart, perfEnd } from './modules/perf.js';
import { safeExecute, safeAsync } from './modules/safe-exec.js';

import {
  loadHotels, loadTemplates, loadSettings, reloadAllData,
  openAddHotelModal, editHotel, closeHotelModal,
  saveHotel, deleteHotel, toggleFavorite, confirmBatchDelete,
  applyTemplateToForm, findTemplateById,
  calculateDays, onCheckInChange, onCheckOutChange,
  calculateDailyPrice, calculateTotalPrice, onDaysChange,
  validateScore, formatScoreOnBlur
} from './modules/hotel-crud.js';

import {
  renderHotelList, handleHotelListClick, handleHotelListChange,
  handleHotelDetailsClick, showHotelDetails, closeHotelDetails,
  toggleViewMode, toggleHotelSelection,
  openRuleDeleteModal, closeRuleDeleteModal, updateRuleDeletePreview, confirmRuleDelete,
  applyFilters, clearFilters, changeRankingMode, updateWeight,
  syncHotelNameFilterOptions, buildHotelNameFilterOptions
} from './modules/hotel-list.js';

import {
  openTemplateManager, closeTemplateModal,
  renderTemplateList, handleTemplateListClick,
  openAddTemplateForm, editTemplate, cancelTemplateForm,
  saveTemplate, deleteTemplate, applyTemplate,
  updateTemplateFilter, setupTemplateSyncListener
} from './modules/template-ui.js';

import {
  openSettings, closeSettingsModal, openPersonalization, closePersonalizationModal, applySettings,
  changeTheme, toggleIncludeFourPersonRoomsForThreePersonTemplate,
  loadDataPath, showDataInFolder, changeDataPath,
  loadAppIconState, chooseAppIcon, resetAppIcon,
  resetSettings,
  openDataTransfer, closeDataTransfer,
  handleExportData, handleImportData,
  openCtripWebsite, openFliggyWebsite, openWebsite,
  refreshCurrentPage, setupMenuListeners
} from './modules/settings-ui.js';
import {
  initializeWindowControls,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow
} from './modules/window-controls.js';

import {
  openAIPrompts, closeAIPrompts,
  openPromptContent, closePromptContent,
  togglePromptEdit, savePromptContent, copyPromptContent
} from './modules/prompt-ui.js';

import { exportRankingImage } from './modules/ranking-image.js';

import {
  applyAppMetadata, openAbout, closeAbout,
  checkAndShowManual, openManual, closeManual
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

/* ============ 暴露到 window（供 HTML 内联处理器调用） ============ */

// 侧栏 & 工具栏
window.openTemplateManager = openTemplateManager;
window.openPersonalization = openPersonalization;
window.openSettings = openSettings;
window.openDataTransfer = openDataTransfer;
window.openAbout = openAbout;
window.clearFilters = clearFilters;
window.openAddHotelModal = openAddHotelModal;
window.exportRankingImage = exportRankingImage;
window.toggleViewMode = toggleViewMode;
window.openRuleDeleteModal = openRuleDeleteModal;
window.closeRuleDeleteModal = closeRuleDeleteModal;
window.updateRuleDeletePreview = updateRuleDeletePreview;
window.confirmRuleDelete = confirmRuleDelete;
window.refreshCurrentPage = refreshCurrentPage;
window.confirmBatchDelete = confirmBatchDelete;
window.minimizeWindow = minimizeWindow;
window.toggleMaximizeWindow = toggleMaximizeWindow;
window.closeWindow = closeWindow;

// 宾馆编辑弹窗
window.closeHotelModal = closeHotelModal;
window.saveHotel = saveHotel;
window.applyTemplateToForm = applyTemplateToForm;
window.calculateDailyPrice = calculateDailyPrice;
window.calculateTotalPrice = calculateTotalPrice;
window.onCheckInChange = onCheckInChange;
window.onCheckOutChange = onCheckOutChange;
window.onDaysChange = onDaysChange;
window.validateScore = validateScore;
window.formatScoreOnBlur = formatScoreOnBlur;

// 模板弹窗
window.closeTemplateModal = closeTemplateModal;
window.openAddTemplateForm = openAddTemplateForm;
window.cancelTemplateForm = cancelTemplateForm;
window.saveTemplate = saveTemplate;

// 设置弹窗
window.closePersonalizationModal = closePersonalizationModal;
window.closeSettingsModal = closeSettingsModal;
window.changeTheme = changeTheme;
window.toggleIncludeFourPersonRoomsForThreePersonTemplate = toggleIncludeFourPersonRoomsForThreePersonTemplate;
window.showDataInFolder = showDataInFolder;
window.changeDataPath = changeDataPath;
window.chooseAppIcon = chooseAppIcon;
window.resetAppIcon = resetAppIcon;
window.openCtripWebsite = openCtripWebsite;
window.openFliggyWebsite = openFliggyWebsite;
window.openAIPrompts = openAIPrompts;
window.openManual = openManual;
window.resetSettings = resetSettings;

// 宾馆详情弹窗
window.closeHotelDetails = closeHotelDetails;

// AI提示词弹窗
window.closeAIPrompts = closeAIPrompts;
window.openPromptContent = openPromptContent;
window.closePromptContent = closePromptContent;
window.togglePromptEdit = togglePromptEdit;
window.savePromptContent = savePromptContent;
window.copyPromptContent = copyPromptContent;

// 数据传输弹窗
window.closeDataTransfer = closeDataTransfer;
window.handleExportData = handleExportData;
window.handleImportData = handleImportData;

// 关于 & 说明书
window.closeAbout = closeAbout;
window.closeManual = closeManual;

// 排名权重
window.changeRankingMode = changeRankingMode;
window.updateWeight = updateWeight;

/* ============ DOM 事件绑定 ============ */

function setupEventListeners() {
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const closers = [
        ['promptContentModal', closePromptContent],
        ['aiPromptsModal', closeAIPrompts],
        ['hotelDetailsModal', closeHotelDetails],
        ['ruleDeleteModal', closeRuleDeleteModal],
        ['hotelModal', closeHotelModal],
        ['templateModal', closeTemplateModal],
        ['dataTransferModal', closeDataTransfer],
        ['manualModal', closeManual],
        ['personalizationModal', closePersonalizationModal],
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
  });

  addEvent('filterName', 'change', applyFilters);
  addEvent('priceSort', 'change', applyFilters);
  addEvent('filterScore', 'change', applyFilters);
  addEvent('filterFavorite', 'change', applyFilters);
  addEvent('filterTemplate', 'change', applyFilters);
  addEvent('filterTransportTime', 'change', applyFilters);
  addEvent('filterSubwayDistance', 'change', applyFilters);
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

    state.settings = loadedSettings || {};
    state.hotels = loadedHotels || [];
    state.templates = loadedTemplates || [];
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
      checkAndShowManual();
      console.log('[初始化] 界面渲染完成');
    });

    state.isInitialized = true;
    console.log('[初始化] 应用初始化完成');
  } catch (error) {
    console.error('[初始化] 初始化失败:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => initializeApp());
