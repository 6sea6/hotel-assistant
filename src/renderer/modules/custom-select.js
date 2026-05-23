/**
 * 自定义下拉组件 —— 将带 data-custom-select="true" 的原生 select 增强为
 * 圆角浮层样式下拉，与采集助手模板选择器视觉语言一致。
 *
 * 原生 select 保持隐藏状态，继续作为真实数据源和事件源。
 * 业务逻辑通过原生 change 事件触发，无需修改。
 */

const OPEN_CLASS = 'is-open';
const SELECTED_CLASS = 'is-selected';
const ACTIVE_CLASS = 'is-active';
const DISABLED_CLASS = 'is-disabled';
const NATIVE_CLASS = 'custom-select-native';
const READY_ATTR = 'customSelectReady';

let openInstance = null;

/* ---- 公共 API ---- */

export function setupCustomSelects(root = document) {
  const selects = root.querySelectorAll('select[data-custom-select="true"]');
  selects.forEach((select) => {
    if (select.id === 'aiTemplateSelect') return;
    if (select.dataset[READY_ATTR] === 'true') return;
    initOne(select);
  });
}

export function refreshCustomSelects(root = document) {
  const selects = root.querySelectorAll('select[data-custom-select="true"]');
  selects.forEach((select) => {
    if (select.id === 'aiTemplateSelect') return;
    if (select.dataset[READY_ATTR] === 'true') {
      rebuildMenu(select);
    } else {
      initOne(select);
    }
  });
}

export function closeAllCustomSelects() {
  if (openInstance) {
    closeMenu(openInstance);
    openInstance = null;
  }
}

/* ---- 初始化单个 select ---- */

function initOne(select) {
  select.dataset[READY_ATTR] = 'true';
  select.classList.add(NATIVE_CLASS);

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  wrapper.dataset.sourceSelectId = select.id || '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'input custom-select-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');

  const textSpan = document.createElement('span');
  textSpan.className = 'custom-select-text';
  button.appendChild(textSpan);

  const caret = document.createElement('span');
  caret.className = 'custom-select-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '⌄';
  button.appendChild(caret);

  const menu = document.createElement('div');
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  wrapper.appendChild(button);
  wrapper.appendChild(menu);

  select.parentNode.insertBefore(wrapper, select.nextSibling);

  const ctx = { select, wrapper, button, textSpan, menu, activeIndex: -1 };

  syncDisabled(ctx);
  buildOptions(ctx);
  syncButtonText(ctx);

  button.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu(ctx);
  });

  button.addEventListener('keydown', (e) => {
    handleButtonKeydown(e, ctx);
  });

  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('.custom-select-option');
    if (!opt) return;
    e.preventDefault();
    selectOption(ctx, opt);
  });

  menu.addEventListener('keydown', (e) => {
    handleMenuKeydown(e, ctx);
  });

  select.addEventListener('change', () => {
    syncButtonText(ctx);
    syncSelectedOption(ctx);
  });

  // 监听原生 select 子节点变化（动态 options）
  const observer = new MutationObserver(() => {
    rebuildMenu(ctx);
  });
  observer.observe(select, { childList: true, subtree: true });
  ctx._observer = observer;

  // 监听 disabled 属性变化
  const attrObserver = new MutationObserver(() => {
    syncDisabled(ctx);
  });
  attrObserver.observe(select, { attributes: true, attributeFilter: ['disabled'] });
  ctx._attrObserver = attrObserver;
}

/* ---- 构建菜单选项 ---- */

function buildOptions(ctx) {
  const { select, menu } = ctx;
  menu.innerHTML = '';

  const options = Array.from(select.options);
  options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-option';
    btn.setAttribute('role', 'option');
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
  const options = menu.querySelectorAll('.custom-select-option');
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
  if (ctx.activeIndex >= 0) {
    ctx.activeIndex = -1;
  }
}

/* ---- 同步按钮文本 ---- */

function syncButtonText(ctx) {
  const { select, textSpan } = ctx;
  const selected = select.selectedOptions[0];
  textSpan.textContent = selected ? selected.textContent : '';
}

/* ---- 同步 disabled ---- */

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

/* ---- 打开/关闭菜单 ---- */

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

  // 高亮当前选中项
  const selectedIndex = select.selectedIndex;
  setActiveIndex(ctx, selectedIndex >= 0 ? selectedIndex : 0);

  positionMenu(ctx);
  openInstance = ctx;

  // 延迟绑定全局事件，避免当前点击立即关闭
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

/* ---- 菜单定位 ---- */

function positionMenu(ctx) {
  const { button, menu } = ctx;
  const rect = button.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const padding = 12;
  const gap = 8;

  // 清理旧样式
  menu.style.maxHeight = '';
  menu.style.overflowY = 'visible';
  menu.style.top = '';
  menu.style.bottom = '';

  // 宽度与水平定位
  const width = rect.width;
  let left = rect.left;
  if (left + width > viewportW - padding) {
    left = viewportW - width - padding;
  }
  if (left < padding) left = padding;
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;

  // 计算菜单自然高度
  const fullHeight = menu.scrollHeight;
  const spaceBelow = viewportH - rect.bottom - padding - gap;
  const spaceAbove = rect.top - padding - gap;

  let openUp = false;
  let available = spaceBelow;
  let scrollable = false;

  if (fullHeight <= spaceBelow) {
    // 下方空间足够，完整显示
    openUp = false;
    available = fullHeight;
  } else if (fullHeight <= spaceAbove) {
    // 下方不够但上方足够，向上展开
    openUp = true;
    available = fullHeight;
  } else {
    // 上下都不够，选择更大的一侧并限制高度
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

/* ---- 选中选项 ---- */

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

/* ---- 键盘导航 ---- */

function setActiveIndex(ctx, index) {
  const options = ctx.menu.querySelectorAll('.custom-select-option');
  if (!options.length) return;

  clearActive(ctx);
  const clamped = Math.max(0, Math.min(index, options.length - 1));
  ctx.activeIndex = clamped;

  const activeOpt = options[clamped];
  if (activeOpt) {
    activeOpt.classList.add(ACTIVE_CLASS);
    activeOpt.setAttribute('aria-selected', 'true');
    if (ctx.menuScrollable) {
      activeOpt.scrollIntoView({ block: 'nearest' });
    }
  }
}

function clearActive(ctx) {
  const prev = ctx.menu.querySelector(`.${ACTIVE_CLASS}`);
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
  const options = ctx.menu.querySelectorAll('.custom-select-option');
  const maxIndex = options.length - 1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    let next = ctx.activeIndex + 1;
    // 跳过 disabled
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

/* ---- 窗口变化时重新定位或关闭 ---- */

window.addEventListener('resize', () => {
  if (openInstance) {
    positionMenu(openInstance);
  }
});

window.addEventListener(
  'scroll',
  () => {
    if (openInstance) {
      positionMenu(openInstance);
    }
  },
  true
);
