/**
 * custom-select —— 统一自定义下拉组件
 *
 * 将原生 <select> 增强为圆角浮层样式下拉，视觉与采集助手模板选择器一致。
 * 原生 select 保持隐藏状态，继续作为真实数据源和事件源。
 * 业务逻辑通过原生 change 事件触发，无需修改。
 *
 * 用法：
 *   <select class="input" data-custom-select="true">
 *     <option value="a">A</option>
 *   </select>
 *
 * 自动增强：
 *   setupCustomSelects(document, { auto: true })
 *   会增强所有 select.input（排除 data-native-select="true" 和 data-custom-select="false"）。
 *
 * 动态刷新：
 *   refreshCustomSelect(select)  — 刷新单个
 *   refreshCustomSelects(root)   — 刷新范围内所有已增强 select
 *
 * 销毁：
 *   destroyCustomSelect(select)  — 移除增强，恢复原生 select
 */

const OPEN_CLASS = 'is-open';
const SELECTED_CLASS = 'is-selected';
const ACTIVE_CLASS = 'is-active';
const DISABLED_CLASS = 'is-disabled';
const NATIVE_CLASS = 'custom-select-native';
const READY_ATTR = 'customSelectReady';
const OPTION_SELECTOR = `[data-custom-select-option="true"]`;

const instances = new WeakMap();
let openInstance = null;
let pendingPositionFrame = 0;

/**
 * 清除失效的 ready 标记。
 * 当 select 有 ready 标记但 WeakMap 中无对应实例时，重置标记以允许重新增强。
 */
function clearStaleReadyState(select) {
  if (!select) return;
  if (select.dataset[READY_ATTR] === 'true' && !instances.get(select)) {
    delete select.dataset[READY_ATTR];
    select.classList.remove(NATIVE_CLASS);
  }
}

/* ============================================================
 * rAF 合并定位调度
 * ============================================================ */

function getAnimationFrame() {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame;
  return (callback) => setTimeout(callback, 16);
}

function getCancelAnimationFrame() {
  if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame;
  return clearTimeout;
}

function schedulePositionOpenMenu() {
  if (!openInstance) return;
  if (pendingPositionFrame) return;
  const raf = getAnimationFrame();
  pendingPositionFrame = raf(() => {
    pendingPositionFrame = 0;
    if (openInstance) {
      positionMenu(openInstance);
    }
  });
}

function cancelPendingPositionFrame() {
  if (!pendingPositionFrame) return;
  getCancelAnimationFrame()(pendingPositionFrame);
  pendingPositionFrame = 0;
}

/* ============================================================
 * MutationObserver rebuild 批处理
 * ============================================================ */

function scheduleRebuild(ctx) {
  if (!ctx || ctx._rebuildScheduled) return;
  ctx._rebuildScheduled = true;

  const run = () => {
    ctx._rebuildScheduled = false;
    if (!instances.get(ctx.select)) return;
    rebuildMenu(ctx);
    if (openInstance === ctx) {
      positionMenu(ctx);
      const selectedIndex = ctx.select.selectedIndex;
      setActiveIndex(ctx, selectedIndex >= 0 ? selectedIndex : 0);
    }
  };

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(run);
  } else {
    Promise.resolve().then(run);
  }
}

/* ============================================================
 * 公共 API
 * ============================================================ */

/**
 * 增强 root 内所有目标 select。
 * @param {Document|Element} root
 * @param {Object} options
 * @param {boolean} [options.auto=false] - 为 true 时额外增强 select.input
 */
export function setupCustomSelects(root = document, options = {}) {
  const selects = findTargetSelects(root, options.auto);
  selects.forEach((select) => enhanceCustomSelect(select));
}

/**
 * 增强单个 select，如果已增强则返回已有实例。
 * @param {HTMLSelectElement} select
 * @param {Object} options
 * @param {string} [options.wrapperClass]
 * @param {string} [options.buttonClass]
 * @param {string} [options.textClass]
 * @param {string} [options.caretClass]
 * @param {string} [options.menuClass]
 * @param {string} [options.optionClass]
 * @param {Object} [options.existingElements] - 复用已有 DOM 元素
 * @param {Element} [options.existingElements.wrapper]
 * @param {Element} [options.existingElements.button]
 * @param {Element} [options.existingElements.textSpan]
 * @param {Element} [options.existingElements.caret]
 * @param {Element} [options.existingElements.menu]
 * @returns {Object} ctx
 */
export function enhanceCustomSelect(select, options = {}) {
  if (!select) return null;
  clearStaleReadyState(select);
  if (select.dataset[READY_ATTR] === 'true') {
    return instances.get(select) || null;
  }
  if (select.multiple || (select.size && select.size > 1)) {
    return null;
  }

  initOne(select, options);
  return instances.get(select);
}

/**
 * 刷新 root 内所有已增强的 select，对未增强的执行增强。
 * @param {Document|Element} root
 * @param {Object} options
 * @param {boolean} [options.auto=false] - 为 true 时额外刷新 select.input
 */
export function refreshCustomSelects(root = document, options = {}) {
  const auto = options.auto === true;
  const selector = auto
    ? `select[data-custom-select="true"], select.${NATIVE_CLASS}, select.input`
    : `select[data-custom-select="true"], select.${NATIVE_CLASS}`;
  const selects = root.querySelectorAll(selector);
  selects.forEach((select) => {
    if (select.multiple || (select.size && select.size > 1)) return;
    if (auto && select.dataset.nativeSelect === 'true') return;
    if (auto && select.dataset.customSelect === 'false') return;
    if (auto && select.dataset.customSelectAuto === 'false') return;
    clearStaleReadyState(select);
    const ctx = instances.get(select);
    if (ctx) {
      rebuildMenu(ctx);
    } else if (select.dataset[READY_ATTR] === 'true') {
      initOne(select);
    }
  });
}

/**
 * 刷新单个 select。
 */
export function refreshCustomSelect(select) {
  if (!select) return;
  clearStaleReadyState(select);
  const ctx = instances.get(select);
  if (ctx) {
    rebuildMenu(ctx);
  } else if (
    select.dataset[READY_ATTR] === 'true' ||
    select.dataset.customSelect === 'true'
  ) {
    initOne(select);
  }
}

/**
 * 销毁增强，恢复原生 select。
 */
export function destroyCustomSelect(select) {
  if (!select) return;
  const ctx = instances.get(select);
  if (!ctx) return;

  if (openInstance === ctx) {
    closeMenu(ctx);
    openInstance = null;
    cancelPendingPositionFrame();
  }

  // 移除事件监听器
  if (ctx.button && ctx._onButtonClick) {
    ctx.button.removeEventListener('click', ctx._onButtonClick);
  }
  if (ctx.button && ctx._onButtonKeydown) {
    ctx.button.removeEventListener('keydown', ctx._onButtonKeydown);
  }
  if (ctx.menu && ctx._onMenuClick) {
    ctx.menu.removeEventListener('click', ctx._onMenuClick);
  }
  if (ctx.menu && ctx._onMenuKeydown) {
    ctx.menu.removeEventListener('keydown', ctx._onMenuKeydown);
  }
  if (ctx.select && ctx._onSelectChange) {
    ctx.select.removeEventListener('change', ctx._onSelectChange);
  }

  // 断开 MutationObserver
  if (ctx._observer) ctx._observer.disconnect();
  if (ctx._attrObserver) ctx._attrObserver.disconnect();

  select.classList.remove(NATIVE_CLASS);
  delete select.dataset[READY_ATTR];

  // 只删除 custom-select 自己创建的 wrapper，保留 existingElements
  if (ctx.ownsWrapper && ctx.wrapper && ctx.wrapper.parentNode) {
    ctx.wrapper.parentNode.removeChild(ctx.wrapper);
  } else {
    // 对 existingElements，只清空 menu 内容并隐藏，保留 DOM
    if (ctx.menu) {
      ctx.menu.innerHTML = '';
      ctx.menu.hidden = true;
    }
  }

  instances.delete(select);
}

/**
 * 关闭当前打开的菜单。
 */
export function closeAllCustomSelects() {
  if (openInstance) {
    closeMenu(openInstance);
    openInstance = null;
    cancelPendingPositionFrame();
  }
}

/**
 * 获取 select 对应的 ctx（调试用）。
 */
export function getCustomSelectInstance(select) {
  return instances.get(select) || null;
}

/* ============================================================
 * 查找目标 select
 * ============================================================ */

function findTargetSelects(root, auto = false) {
  const results = [];
  const selector = auto
    ? 'select[data-custom-select="true"], select.input'
    : 'select[data-custom-select="true"]';
  const candidates = root.querySelectorAll(selector);

  candidates.forEach((select) => {
    if (select.dataset.nativeSelect === 'true') return;
    if (select.dataset.customSelect === 'false') return;
    if (auto && select.dataset.customSelectAuto === 'false') return;
    if (select.multiple) return;
    if (select.size && select.size > 1) return;
    if (select.dataset[READY_ATTR] === 'true') return;
    results.push(select);
  });

  return results;
}

/* ============================================================
 * 初始化单个 select
 * ============================================================ */

function initOne(select, options = {}) {
  if (select.dataset[READY_ATTR] === 'true') {
    return;
  }

  const wrapperClass = options.wrapperClass || 'custom-select';
  const buttonClass = options.buttonClass || 'input custom-select-button';
  const textClass = options.textClass || 'custom-select-text';
  const caretClass = options.caretClass || 'custom-select-caret';
  const menuClass = options.menuClass || 'custom-select-menu';
  const optionClass = options.optionClass || 'custom-select-option';
  const existing = options.existingElements || {};

  select.dataset[READY_ATTR] = 'true';
  select.classList.add(NATIVE_CLASS);

  // 复用或创建 wrapper
  let wrapper = existing.wrapper || document.createElement('div');
  wrapper.className = wrapperClass;
  wrapper.dataset.sourceSelectId = select.id || '';

  // 复用或创建 button
  let button = existing.button;
  let textSpan = existing.textSpan;
  let caret = existing.caret;

  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = buttonClass;
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    textSpan = document.createElement('span');
    textSpan.className = textClass;
    button.appendChild(textSpan);

    caret = document.createElement('span');
    caret.className = caretClass;
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '\u2304';
    button.appendChild(caret);
  } else {
    if (!textSpan) {
      textSpan = button.querySelector(`.${textClass.split(' ')[0]}`) ||
        button.querySelector('span');
    }
    if (!caret) {
      caret = button.querySelector(`.${caretClass.split(' ')[0]}`) ||
        button.querySelectorAll('span')[1];
    }
    if (!button.hasAttribute('aria-haspopup')) {
      button.setAttribute('aria-haspopup', 'listbox');
    }
    if (!button.hasAttribute('aria-expanded')) {
      button.setAttribute('aria-expanded', 'false');
    }
  }

  // 复用或创建 menu
  let menu = existing.menu || document.createElement('div');
  menu.className = menuClass;
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  // 只在 wrapper 未挂载到 DOM 时插入
  if (!existing.wrapper || !wrapper.parentNode) {
    select.parentNode.insertBefore(wrapper, select.nextSibling);
  }
  if (!button.parentNode || button.parentNode !== wrapper) {
    wrapper.insertBefore(button, wrapper.firstChild);
  }
  if (!menu.parentNode || menu.parentNode !== wrapper) {
    wrapper.appendChild(menu);
  }

  const ctx = {
    select,
    wrapper,
    button,
    textSpan,
    caret,
    menu,
    activeIndex: -1,
    optionClass,
    menuScrollable: false,
    ownsWrapper: !existing.wrapper,
    ownsButton: !existing.button,
    ownsMenu: !existing.menu,
    _observer: null,
    _attrObserver: null
  };

  instances.set(select, ctx);

  syncDisabled(ctx);
  buildOptions(ctx);
  syncButtonText(ctx);
  syncSelectedOption(ctx);

  // 事件绑定
  ctx._onButtonClick = (e) => { e.preventDefault(); toggleMenu(ctx); };
  ctx._onButtonKeydown = (e) => { handleButtonKeydown(e, ctx); };
  ctx._onMenuClick = (e) => {
    const opt = e.target.closest(OPTION_SELECTOR);
    if (!opt) return;
    e.preventDefault();
    selectOption(ctx, opt);
  };
  ctx._onMenuKeydown = (e) => { handleMenuKeydown(e, ctx); };
  ctx._onSelectChange = () => { syncButtonText(ctx); syncSelectedOption(ctx); };

  button.addEventListener('click', ctx._onButtonClick);
  button.addEventListener('keydown', ctx._onButtonKeydown);
  menu.addEventListener('click', ctx._onMenuClick);
  menu.addEventListener('keydown', ctx._onMenuKeydown);
  select.addEventListener('change', ctx._onSelectChange);

  // 监听原生 select 子节点变化（动态 options）—— 批处理
  ctx._observer = new MutationObserver(() => { scheduleRebuild(ctx); });
  ctx._observer.observe(select, { childList: true, subtree: true });

  // 监听 disabled 属性变化
  ctx._attrObserver = new MutationObserver(() => { syncDisabled(ctx); });
  ctx._attrObserver.observe(select, { attributes: true, attributeFilter: ['disabled'] });
}

/* ============================================================
 * 构建菜单选项
 * ============================================================ */

function buildOptions(ctx) {
  const { select, menu, optionClass } = ctx;
  menu.innerHTML = '';

  const options = Array.from(select.options);
  options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = optionClass;
    btn.setAttribute('role', 'option');
    btn.dataset.customSelectOption = 'true';
    btn.dataset.index = String(index);
    btn.dataset.value = opt.value;
    btn.textContent = opt.textContent;

    if (opt.disabled) {
      btn.classList.add(DISABLED_CLASS);
      btn.setAttribute('aria-disabled', 'true');
    }

    if (index === select.selectedIndex) {
      btn.classList.add(SELECTED_CLASS);
      btn.setAttribute('aria-selected', 'true');
    }

    menu.appendChild(btn);
  });
}

function syncSelectedOption(ctx) {
  const { select, menu } = ctx;
  const options = menu.querySelectorAll(OPTION_SELECTOR);
  const selectedValue = select.value;
  options.forEach((option) => {
    const isSelected = option.dataset.value === selectedValue;
    option.classList.toggle(SELECTED_CLASS, isSelected);
    option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

function rebuildMenu(ctx) {
  buildOptions(ctx);
  syncButtonText(ctx);
  syncSelectedOption(ctx);
  syncDisabled(ctx);
  if (ctx.activeIndex >= 0) {
    ctx.activeIndex = -1;
  }
}

/* ============================================================
 * 同步按钮文本
 * ============================================================ */

function syncButtonText(ctx) {
  const { select, textSpan } = ctx;
  if (!textSpan) return;
  const selected = select.selectedOptions[0];
  textSpan.textContent = selected ? selected.textContent : '';
}

/* ============================================================
 * 同步 disabled
 * ============================================================ */

function syncDisabled(ctx) {
  const { select, wrapper, button } = ctx;
  if (select.disabled) {
    wrapper.classList.add(DISABLED_CLASS);
    button.disabled = true;
  } else {
    wrapper.classList.remove(DISABLED_CLASS);
    button.disabled = false;
  }
}

/* ============================================================
 * 打开/关闭菜单
 * ============================================================ */

function toggleMenu(ctx) {
  if (openInstance && openInstance !== ctx) {
    closeMenu(openInstance);
  }
  if (ctx.menu.hidden) {
    openMenu(ctx);
  } else {
    closeMenu(ctx);
  }
}

function openMenu(ctx) {
  const { wrapper, button, menu, select } = ctx;
  wrapper.classList.add(OPEN_CLASS);
  button.setAttribute('aria-expanded', 'true');
  menu.hidden = false;

  positionMenu(ctx);

  const selectedIndex = select.selectedIndex;
  setActiveIndex(ctx, selectedIndex >= 0 ? selectedIndex : 0);

  openInstance = ctx;
  ensureGlobalListeners();

  requestAnimationFrame(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleGlobalKey);
  });
}

function closeMenu(ctx) {
  if (!ctx) return;
  const { wrapper, button, menu } = ctx;
  wrapper.classList.remove(OPEN_CLASS);
  button.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
  clearActive(ctx);

  document.removeEventListener('mousedown', handleOutsideClick);
  document.removeEventListener('keydown', handleGlobalKey);

  if (openInstance === ctx) {
    openInstance = null;
    cancelPendingPositionFrame();
  }
}

function handleOutsideClick(e) {
  if (!openInstance) return;
  const { wrapper } = openInstance;
  if (!wrapper.contains(e.target)) {
    closeMenu(openInstance);
  }
}

function handleGlobalKey(e) {
  if (!openInstance) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    openInstance.button.focus();
    closeMenu(openInstance);
  } else if (e.key === 'Tab') {
    closeMenu(openInstance);
  }
}

/* ============================================================
 * 菜单定位
 * ============================================================ */

function positionMenu(ctx) {
  const { button, menu } = ctx;
  const rect = button.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const padding = 12;
  const gap = 8;

  menu.style.maxHeight = '';
  menu.style.overflowY = 'visible';
  menu.style.top = '';
  menu.style.bottom = '';

  const width = rect.width;
  let left = rect.left;
  if (left + width > viewportW - padding) {
    left = viewportW - width - padding;
  }
  if (left < padding) left = padding;
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;

  const fullHeight = menu.scrollHeight;
  const spaceBelow = viewportH - rect.bottom - padding - gap;
  const spaceAbove = rect.top - padding - gap;

  let openUp = false;
  let available = spaceBelow;
  let scrollable = false;

  if (fullHeight <= spaceBelow) {
    openUp = false;
    available = fullHeight;
  } else if (fullHeight <= spaceAbove) {
    openUp = true;
    available = fullHeight;
  } else {
    openUp = spaceAbove > spaceBelow;
    available = Math.max(120, openUp ? spaceAbove : spaceBelow);
    scrollable = true;
  }

  if (scrollable) {
    menu.style.maxHeight = `${available}px`;
    menu.style.overflowY = 'auto';
  } else {
    menu.style.maxHeight = `${fullHeight}px`;
    menu.style.overflowY = 'visible';
  }

  if (openUp) {
    menu.style.top = 'auto';
    menu.style.bottom = `${viewportH - rect.top + gap}px`;
  } else {
    menu.style.bottom = 'auto';
    menu.style.top = `${rect.bottom + gap}px`;
  }

  ctx.menuScrollable = scrollable;
}

/* ============================================================
 * 选中选项
 * ============================================================ */

function selectOption(ctx, optElement) {
  if (optElement.classList.contains(DISABLED_CLASS)) return;

  const { select } = ctx;
  const value = optElement.dataset.value;

  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  syncButtonText(ctx);
  syncSelectedOption(ctx);
  closeMenu(ctx);
  ctx.button.focus();
}

/* ============================================================
 * 键盘导航
 * ============================================================ */

function setActiveIndex(ctx, index) {
  const options = ctx.menu.querySelectorAll(OPTION_SELECTOR);
  if (!options.length) return;

  clearActive(ctx);
  const clamped = Math.max(0, Math.min(index, options.length - 1));
  ctx.activeIndex = clamped;

  const activeOpt = options[clamped];
  if (activeOpt) {
    activeOpt.classList.add(ACTIVE_CLASS);
    if (ctx.menuScrollable) {
      activeOpt.scrollIntoView({ block: 'nearest' });
    }
  }
}

function clearActive(ctx) {
  const prev = ctx.menu.querySelector(`${OPTION_SELECTOR}.${ACTIVE_CLASS}`);
  if (prev) {
    prev.classList.remove(ACTIVE_CLASS);
  }
  ctx.activeIndex = -1;
}

function handleButtonKeydown(e, ctx) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleMenu(ctx);
  }
}

function handleMenuKeydown(e, ctx) {
  const options = ctx.menu.querySelectorAll(OPTION_SELECTOR);
  const maxIndex = options.length - 1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    let next = ctx.activeIndex + 1;
    while (next <= maxIndex && options[next]?.classList.contains(DISABLED_CLASS)) next++;
    if (next <= maxIndex) setActiveIndex(ctx, next);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    let prev = ctx.activeIndex - 1;
    while (prev >= 0 && options[prev]?.classList.contains(DISABLED_CLASS)) prev--;
    if (prev >= 0) setActiveIndex(ctx, prev);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (ctx.activeIndex >= 0 && ctx.activeIndex <= maxIndex) {
      selectOption(ctx, options[ctx.activeIndex]);
    }
  }
}

/* ============================================================
 * 窗口变化时重新定位或关闭（延迟绑定，避免模块加载时副作用）
 * ============================================================ */

let globalListenersBound = false;

function ensureGlobalListeners() {
  if (globalListenersBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  globalListenersBound = true;

  window.addEventListener('resize', () => {
    schedulePositionOpenMenu();
  });

  window.addEventListener(
    'scroll',
    () => {
      schedulePositionOpenMenu();
    },
    true
  );
}
