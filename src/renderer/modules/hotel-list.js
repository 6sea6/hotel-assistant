/**
 * 宾馆列表入口门面 —— 具体职责拆到 controller / renderers / selection / empty state / virtual adapter。
 */

import './hotel-list-empty-state.js';
import './hotel-list-table-renderer.js';
import './hotel-list-card-renderer.js';
import './hotel-list-model.js';
import './hotel-list-filter-options.js';
import './hotel-list-patch.js';
import './hotel-list-render-orchestrator.js';
import './rule-delete-controller.js';
import './hotel-list-selection.js';
import './hotel-list-virtual-adapter.js';

export { shouldFullRerender } from './hotel-render-decision.js';
export * from './hotel-list-controller.js';
export * from './hotel-list-table-renderer.js';
export * from './hotel-list-card-renderer.js';
export * from './hotel-list-model.js';
export * from './hotel-list-filter-options.js';
export * from './hotel-list-patch.js';
export * from './hotel-list-render-orchestrator.js';
export * from './rule-delete-controller.js';
export * from './hotel-list-selection.js';
export * from './hotel-list-virtual-adapter.js';
