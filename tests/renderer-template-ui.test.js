const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let templateUiModuleUrl = '';
let templateUiStateModuleUrl = '';
let templateUiActionsModuleUrl = '';

function writeStub(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function loadTemplateUiModules() {
  if (!templateUiModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-template-ui-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');

    writeStub(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');
    fs.copyFileSync(path.join(sourceDir, 'template-ui.js'), path.join(tempRoot, 'template-ui.js'));

    writeStub(
      path.join(tempRoot, 'state.js'),
      `
      export const state = globalThis.__templateUiState;
      export const TEMPLATE_FILTER_BATCH_SIZE = 50;
      export function setTemplates(templates, event = {}) {
        state.templates = templates;
        for (const listener of state.templateListeners) listener({ ...event, templates });
      }
      export function setHotels(hotels) { state.hotels = hotels; }
      export function subscribeTemplateChanges(listener) {
        state.templateListeners.add(listener);
        return () => state.templateListeners.delete(listener);
      }
      export function markRankingCacheDirty() { state.rankingDirty = true; }
      `
    );

    writeStub(
      path.join(tempRoot, 'dom-helpers.js'),
      `
      export function $(id) { return globalThis.__templateUiElements.get(id) || null; }
      export function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }
      export function getValue(id, fallback = '') {
        const el = $(id);
        return el ? el.value : fallback;
      }
      export function setValue(id, value) {
        const el = $(id);
        if (el) el.value = String(value ?? '');
      }
      export function setText(id, value) {
        const el = $(id);
        if (el) el.textContent = String(value ?? '');
      }
      export function setStyle(id, name, value) {
        const el = $(id);
        if (el) el.style[name] = value;
      }
      export function normalizeIdValue(value) {
        if (value === null || value === undefined || value === '') return null;
        return /^-?\\d+$/.test(String(value)) ? Number(value) : String(value);
      }
      export function getRoomCountText(value) { return String(value) + '人'; }
      `
    );

    writeStub(
      path.join(tempRoot, 'notification.js'),
      `export function showNotification(message, type) {
        globalThis.__templateUiNotifications.push({ message, type });
      }`
    );

    writeStub(
      path.join(tempRoot, 'ui-utils.js'),
      `export function setModalActive() {}
       export function resetDeleteConfirmation() {}
       export function startDeleteConfirmation() {}`
    );

    writeStub(
      path.join(tempRoot, 'render-scheduler.js'),
      `export function isHotelInputPriorityActive() { return false; }`
    );

    writeStub(
      path.join(tempRoot, 'actions.js'),
      `
      export const actions = {
        async reloadAllData() {
          globalThis.__templateUiReloadCalls += 1;
          globalThis.__templateUiState.templates = globalThis.__templateUiNextTemplates.map((item) => ({ ...item }));
          return { hotelsCount: 0, templatesCount: globalThis.__templateUiState.templates.length, settingsLoaded: false };
        },
        async loadHotels() {
          globalThis.__templateUiLoadHotelsCalls += 1;
          return globalThis.__templateUiNextHotels.map((item) => ({ ...item }));
        },
        async loadTemplates() {
          globalThis.__templateUiLoadTemplatesCalls += 1;
          return globalThis.__templateUiNextTemplates.map((item) => ({ ...item }));
        },
        findTemplateById(id) {
          return globalThis.__templateUiState.templates.find((item) => String(item.id) === String(id));
        },
        openAddHotelModal() {},
        requestHotelListRender() {},
        renderHotelList() {},
        renderAiTemplateOptions() {
          globalThis.__templateUiAiTemplateRenderCalls += 1;
        }
      };
      `
    );

    writeStub(
      path.join(tempRoot, 'custom-select.js'),
      `export function refreshCustomSelects() {
        globalThis.__templateUiCustomSelectRefreshCalls += 1;
      }`
    );

    writeStub(
      path.join(tempRoot, 'hotel-derived.js'),
      `export function attachDerivedFieldsToHotel(hotel) {
        return { ...hotel, _derived: { nameKey: String(hotel?.name || '').toLocaleLowerCase('zh-CN') } };
      }`
    );

    writeStub(path.join(tempRoot, 'debug-log.js'), `export function logRendererDebug() {}`);

    templateUiModuleUrl = pathToFileURL(path.join(tempRoot, 'template-ui.js')).href;
    templateUiStateModuleUrl = pathToFileURL(path.join(tempRoot, 'state.js')).href;
    templateUiActionsModuleUrl = pathToFileURL(path.join(tempRoot, 'actions.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  const [module, stateModule, actionsModule] = await Promise.all([
    import(templateUiModuleUrl),
    import(templateUiStateModuleUrl),
    import(templateUiActionsModuleUrl)
  ]);

  return {
    module,
    state: stateModule.state,
    actions: actionsModule.actions
  };
}

function createElement(value = '') {
  return {
    value,
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    focus() {},
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      }
    },
    appendChild() {},
    setAttribute() {}
  };
}

function installTemplateUiDom() {
  const elements = new Map();
  [
    'templateList',
    'templateForm',
    'templateFormTitle',
    'templateId',
    'templateName',
    'templateDestination',
    'templateCheckIn',
    'templateCheckOut',
    'templateRoomCount'
  ].forEach((id) => elements.set(id, createElement()));

  globalThis.__templateUiElements = elements;
  if (!globalThis.__templateUiState) {
    globalThis.__templateUiState = {};
  }

  const templateListeners = globalThis.__templateUiState.templateListeners || new Set();
  Object.assign(globalThis.__templateUiState, {
    templates: [],
    hotels: [],
    templateFilterRenderVersion: 0,
    rankingDirty: false,
    templateListeners
  });
  globalThis.__templateUiNextTemplates = [];
  globalThis.__templateUiNextHotels = [];
  globalThis.__templateUiNotifications = [];
  globalThis.__templateUiReloadCalls = 0;
  globalThis.__templateUiLoadTemplatesCalls = 0;
  globalThis.__templateUiLoadHotelsCalls = 0;
  globalThis.__templateUiAiTemplateRenderCalls = 0;
  globalThis.__templateUiCustomSelectRefreshCalls = 0;

  global.window = {
    electronAPI: {
      updateTemplateAndSync: async (template) => {
        globalThis.__templateUiSavedTemplate = template;
        return { success: true, affectedCount: 0 };
      },
      addTemplate: async (template) => {
        globalThis.__templateUiSavedTemplate = template;
        return { success: true };
      },
      deleteTemplate: async () => ({ success: true })
    }
  };
  global.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    createDocumentFragment() {
      return createElement();
    },
    createElement() {
      return createElement();
    }
  };
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  return elements;
}

test('saving an edited template refreshes the AI task template picker immediately', async () => {
  const elements = installTemplateUiDom();
  const { module } = await loadTemplateUiModules();

  globalThis.__templateUiState.templates = [
    { id: 'tpl-1', name: '旧模板', destination: '武汉', room_count: 1 }
  ];
  globalThis.__templateUiNextTemplates = [
    { id: 'tpl-1', name: '新模板', destination: '上海', room_count: 2 }
  ];

  elements.get('templateId').value = 'tpl-1';
  elements.get('templateName').value = '新模板';
  elements.get('templateDestination').value = '上海';
  elements.get('templateCheckIn').value = '2026-06-17';
  elements.get('templateCheckOut').value = '2026-06-18';
  elements.get('templateRoomCount').value = '2';

  await module.saveTemplate();

  assert.equal(globalThis.__templateUiReloadCalls, 0);
  assert.equal(globalThis.__templateUiLoadTemplatesCalls, 1);
  assert.equal(globalThis.__templateUiLoadHotelsCalls, 0);
  assert.equal(globalThis.__templateUiAiTemplateRenderCalls, 1);
  assert.match(elements.get('templateList').innerHTML, /新模板/);
});

test('saving a template that updates hotels reloads hotels once and then refreshes template UI', async () => {
  const elements = installTemplateUiDom();
  const { module } = await loadTemplateUiModules();

  global.window.electronAPI.updateTemplateAndSync = async (template) => {
    globalThis.__templateUiSavedTemplate = template;
    return { success: true, affectedCount: 2 };
  };
  globalThis.__templateUiState.templates = [
    { id: 'tpl-1', name: '旧模板', destination: '武汉', room_count: 1 }
  ];
  globalThis.__templateUiNextTemplates = [
    { id: 'tpl-1', name: '新模板', destination: '上海', room_count: 2 }
  ];
  globalThis.__templateUiNextHotels = [
    { id: 'hotel-1', name: '酒店 A', template_id: 'tpl-1' },
    { id: 'hotel-2', name: '酒店 B', template_id: 'tpl-1' }
  ];

  elements.get('templateId').value = 'tpl-1';
  elements.get('templateName').value = '新模板';
  elements.get('templateDestination').value = '上海';
  elements.get('templateCheckIn').value = '2026-06-17';
  elements.get('templateCheckOut').value = '2026-06-18';
  elements.get('templateRoomCount').value = '2';

  await module.saveTemplate();

  assert.equal(globalThis.__templateUiReloadCalls, 0);
  assert.equal(globalThis.__templateUiLoadTemplatesCalls, 1);
  assert.equal(globalThis.__templateUiLoadHotelsCalls, 1);
  assert.equal(globalThis.__templateUiState.hotels.length, 2);
  assert.equal(globalThis.__templateUiAiTemplateRenderCalls, 1);
  assert.match(elements.get('templateList').innerHTML, /新模板/);
});
