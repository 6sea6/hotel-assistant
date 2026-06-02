/**
 * 设置 UI 兼容入口。
 */

import { actions } from './actions.js';
import { applySettings, refreshCurrentPage } from './settings-form-ui.js';
import { loadDataPath, openWebsite } from './data-transfer-ui.js';
import { loadAppIconState } from './personalization-ui.js';

export * from './settings-form-ui.js';
export * from './personalization-ui.js';
export * from './data-transfer-ui.js';
export * from './list-prefilter-ui.js';

actions.openWebsite = openWebsite;
actions.applySettings = applySettings;
actions.refreshCurrentPage = refreshCurrentPage;
actions.loadDataPath = loadDataPath;
actions.loadAppIconState = loadAppIconState;
