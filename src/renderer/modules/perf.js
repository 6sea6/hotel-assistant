/**
 * 轻量性能埋点工具 —— 用于排查渲染与 IPC 卡顿。
 */

const __perf = { marks: {}, measures: [] };

export function perfStart(name) {
  try { __perf.marks[name] = performance.now(); console.debug(`[perf] start ${name}`); } catch (e) {}
}

export function perfEnd(name) {
  try {
    const s = __perf.marks[name];
    if (!s) return;
    const d = performance.now() - s;
    __perf.measures.push({ name, duration: d });
    console.info(`[PERF] ${name}: ${d.toFixed(1)} ms`);
    delete __perf.marks[name];
  } catch (e) {}
}

// 暴露到全局供控制台调试
window.__getPerfMeasures = () => (__perf.measures.slice());
