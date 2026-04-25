/**
 * 渲染调度器 —— 控制宾馆列表的延迟渲染、优先级让步和批量恢复。
 *
 * 当宾馆编辑弹窗打开时，列表渲染任务会被推迟以优先响应用户输入操作。
 */

import { state } from './state.js';
import { $ } from './dom-helpers.js';

export function isHotelInputPriorityActive() {
  return Boolean($('hotelModal')?.classList.contains('active'));
}

export function clearPendingHotelRenderTimers() {
  if (state.hotelRenderDelayTimer) {
    clearTimeout(state.hotelRenderDelayTimer);
    state.hotelRenderDelayTimer = 0;
  }
  if (state.hotelRenderResumeTimer) {
    clearTimeout(state.hotelRenderResumeTimer);
    state.hotelRenderResumeTimer = 0;
  }
}

export function queueHotelRenderResume(renderJob, delay = 120) {
  state.pendingHotelRenderResume = renderJob;

  if (state.hotelRenderResumeTimer) {
    clearTimeout(state.hotelRenderResumeTimer);
  }

  state.hotelRenderResumeTimer = window.setTimeout(() => {
    state.hotelRenderResumeTimer = 0;

    if (isHotelInputPriorityActive()) {
      queueHotelRenderResume(renderJob, delay);
      return;
    }

    const pendingJob = state.pendingHotelRenderResume;
    state.pendingHotelRenderResume = null;
    if (pendingJob) {
      requestAnimationFrame(pendingJob);
    }
  }, delay);
}

export function resumeDeferredHotelRender() {
  if (isHotelInputPriorityActive() || !state.pendingHotelRenderResume) {
    return;
  }

  const pendingJob = state.pendingHotelRenderResume;
  state.pendingHotelRenderResume = null;

  if (state.hotelRenderResumeTimer) {
    clearTimeout(state.hotelRenderResumeTimer);
    state.hotelRenderResumeTimer = 0;
  }

  requestAnimationFrame(pendingJob);
}

export function scheduleHotelRenderTask(renderJob, delay = 0) {
  if (delay > 0) {
    if (state.hotelRenderDelayTimer) {
      clearTimeout(state.hotelRenderDelayTimer);
    }

    state.hotelRenderDelayTimer = window.setTimeout(() => {
      state.hotelRenderDelayTimer = 0;
      if (isHotelInputPriorityActive()) {
        queueHotelRenderResume(renderJob);
        return;
      }
      requestAnimationFrame(renderJob);
    }, delay);
    return;
  }

  if (isHotelInputPriorityActive()) {
    queueHotelRenderResume(renderJob);
    return;
  }

  requestAnimationFrame(renderJob);
}
