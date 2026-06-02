/**
 * 宾馆列表渲染调度 —— full render / virtual render / patch decision 的主入口。
 */

import {
  state,
  LARGE_HOTEL_RENDER_THRESHOLD,
  INTERACTION_FIRST_RENDER_DELAY,
  updateCurrentFilters,
  bumpHotelListRenderVersion,
  setRenderScheduled,
  setPendingRenderInteractionFirst
} from './state.js';
import { perfStart, perfEnd } from './perf.js';
import {
  isHotelInputPriorityActive,
  clearPendingHotelRenderTimers,
  scheduleHotelRenderTask
} from './render-scheduler.js';
import { getHotelListRenderDecision } from './hotel-render-decision.js';
import { getSortedVisibleHotels } from './hotel-list-model.js';
import { syncHotelNameFilterOptions } from './hotel-list-filter-options.js';
import { patchHotelCards, updateVisibleHotelSummary } from './hotel-list-patch.js';
import { shouldUseVirtualHotelList, getVirtualScrollThreshold } from './hotel-virtual-list.js';
import { renderHotelListPreparingState } from './hotel-list-empty-state.js';
import { renderHotelListView } from './hotel-list-table-renderer.js';
import { renderHotelCardGrid } from './hotel-list-card-renderer.js';
import {
  renderVirtualHotelCardGrid,
  renderVirtualHotelListView,
  resetVirtualHotelListState
} from './hotel-list-virtual-adapter.js';
import { configureHotelListSelection, syncSelectAllCheckboxState } from './hotel-list-selection.js';
import { actions } from './actions.js';

configureHotelListSelection({ getSortedVisibleHotels });

/**
 * @param {{reason?: string, changedIds?: Array<string|number|null|undefined>|Set<string|number|null|undefined>, forceFull?: boolean, interactionFirst?: boolean}} [options]
 * @returns {void}
 */
export function requestHotelListRender(options = {}) {
  const decision = getHotelListRenderDecision({
    reason: options.reason,
    changedIds: options.changedIds,
    forceFull: options.forceFull,
    renderScheduled: state.renderScheduled,
    hasPendingRenderResume: Boolean(state.pendingHotelRenderResume)
  });

  if (
    decision.mode === 'patch' &&
    patchHotelCards(decision.changedIds, { reason: decision.reason })
  ) {
    return;
  }

  renderHotelList({ interactionFirst: options.interactionFirst, reason: decision.reason });
}

export function renderHotelList(options = {}) {
  bumpHotelListRenderVersion();
  setPendingRenderInteractionFirst(
    state.pendingRenderInteractionFirst || Boolean(options.interactionFirst)
  );
  if (state.renderScheduled) return;

  clearPendingHotelRenderTimers();
  resetVirtualHotelListState();
  setRenderScheduled(true);

  const runRender = () => {
    setRenderScheduled(false);
    const taskVersion = state.hotelListRenderVersion;
    const interactionFirst = state.pendingRenderInteractionFirst;
    setPendingRenderInteractionFirst(false);
    const perfLabel = `renderHotelList:${taskVersion}`;
    perfStart(perfLabel);
    const container = document.getElementById('hotelList');
    const countElement = document.getElementById('hotelCount');
    const roomTypeCountElement = document.getElementById('roomTypeCount');

    if (!container || !countElement || !roomTypeCountElement) {
      console.error('[renderHotelList] 关键DOM元素未找到');
      perfEnd(perfLabel);
      return;
    }

    if (interactionFirst && isHotelInputPriorityActive()) {
      setRenderScheduled(true);
      scheduleHotelRenderTask(runRender, 120);
      perfEnd(perfLabel);
      return;
    }

    const currentNameFilter = String(state.currentFilters.name || '');
    const syncedNameFilter = syncHotelNameFilterOptions({ selectedValue: currentNameFilter });
    if (currentNameFilter !== syncedNameFilter) {
      updateCurrentFilters({ name: syncedNameFilter });
    }

    const sortedHotels = getSortedVisibleHotels();
    updateVisibleHotelSummary(sortedHotels);

    if (sortedHotels.length === 0) {
      const hasActiveFilters = Object.values(state.currentFilters).some(
        (value) => value !== undefined && value !== null && value !== ''
      );
      state.renderedHotelNodeMap?.clear?.();
      const isFilterEmptyState = state.hotels.length > 0 && hasActiveFilters;
      const emptyAction = isFilterEmptyState ? 'clear-filters' : 'open-ai-assistant';
      const emptyActionText = isFilterEmptyState ? '清除筛选' : '打开采集助手';
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏨</div>
          <div class="empty-state-text">${isFilterEmptyState ? '当前筛选条件下没有匹配结果' : '暂无宾馆数据'}</div>
          <button class="btn ${isFilterEmptyState ? 'btn-secondary' : 'btn-primary'}" type="button" data-action="${emptyAction}">${emptyActionText}</button>
        </div>
      `;
      perfEnd(perfLabel);
      return;
    }

    container.innerHTML = '';
    state.renderedHotelNodeMap?.clear?.();
    container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';

    try {
      const virtualScrollThreshold = getVirtualScrollThreshold(state.viewMode);
      if (shouldUseVirtualHotelList(sortedHotels.length, { threshold: virtualScrollThreshold })) {
        if (state.viewMode === 'list') {
          renderVirtualHotelListView(
            container,
            sortedHotels,
            taskVersion,
            perfLabel,
            options.reason,
            {
              finishHotelRender
            }
          );
        } else {
          renderVirtualHotelCardGrid(
            container,
            sortedHotels,
            taskVersion,
            perfLabel,
            options.reason,
            {
              finishHotelRender
            }
          );
        }
        return;
      }
    } catch (error) {
      console.error('[virtual-list] fallback to full render', error);
    }

    if (state.viewMode === 'list') {
      renderHotelListView(container, sortedHotels, taskVersion, perfLabel, {
        finishHotelRender,
        syncSelectAllCheckboxState
      });
    } else {
      renderHotelCardGrid(container, sortedHotels, taskVersion, perfLabel, {
        finishHotelRender
      });
    }
  };

  if (state.pendingRenderInteractionFirst && state.hotels.length > LARGE_HOTEL_RENDER_THRESHOLD) {
    renderHotelListPreparingState();
    scheduleHotelRenderTask(runRender, INTERACTION_FIRST_RENDER_DELAY);
    return;
  }

  scheduleHotelRenderTask(runRender);
}

function finishHotelRender(taskVersion, perfLabel) {
  if (taskVersion !== state.hotelListRenderVersion) {
    perfEnd(perfLabel);
    return;
  }
  perfEnd(perfLabel);
}

actions.renderHotelList = renderHotelList;
actions.requestHotelListRender = requestHotelListRender;
