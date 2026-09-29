/**
 * 宾馆列表筛选选项 —— 同步名称筛选下拉，避免渲染/patch 模块反向依赖 controller。
 */

import { state, setHotelNameFilterOptionSignature } from './state.js';
import { $, normalizeFilterOptionKey } from './dom-helpers.js';

const MAX_VISIBLE_NAME_SUGGESTIONS = 80;
let activeSuggestionIndex = -1;
/** @type {string[]} */
let visibleSuggestionNames = [];

export function buildHotelNameFilterOptions(sourceHotels) {
  sourceHotels = sourceHotels || state.hotels;
  const seen = new Set();
  const options = [];
  for (const hotel of sourceHotels) {
    const name = hotel?.name;
    if (!name) continue;
    const key = normalizeFilterOptionKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      options.push(name);
    }
  }
  options.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return options;
}

/**
 * @param {string} query
 * @param {Array<{name?: string|null}>} [sourceHotels]
 * @returns {string[]}
 */
export function getFilteredHotelNameSuggestions(query, sourceHotels) {
  const normalizedQuery = normalizeFilterOptionKey(query);
  return buildHotelNameFilterOptions(sourceHotels)
    .filter((name) => !normalizedQuery || normalizeFilterOptionKey(name).includes(normalizedQuery))
    .slice(0, MAX_VISIBLE_NAME_SUGGESTIONS);
}

function getComboboxElements() {
  return {
    wrapper: /** @type {HTMLElement|null} */ ($('hotelNameCombobox')),
    input: /** @type {HTMLInputElement|null} */ ($('filterName')),
    toggle: /** @type {HTMLButtonElement|null} */ ($('hotelNameComboboxToggle')),
    menu: /** @type {HTMLElement|null} */ ($('hotelNameSuggestions'))
  };
}

function syncComboboxExpandedState(expanded) {
  const { wrapper, input, toggle, menu } = getComboboxElements();
  if (!input || !menu) return;
  menu.hidden = !expanded;
  input.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  toggle?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  wrapper?.classList.toggle('is-open', expanded);
  if (!expanded) {
    activeSuggestionIndex = -1;
    input.removeAttribute('aria-activedescendant');
  }
}

function syncActiveSuggestion() {
  const { input, menu } = getComboboxElements();
  if (!input || !menu) return;
  const optionElements = Array.from(menu.querySelectorAll('.hotel-name-suggestion-option'));
  optionElements.forEach((option, index) => {
    option.classList.toggle('is-active', index === activeSuggestionIndex);
  });
  const activeOption = /** @type {HTMLElement|undefined} */ (optionElements[activeSuggestionIndex]);
  if (!activeOption) {
    input.removeAttribute('aria-activedescendant');
    return;
  }
  input.setAttribute('aria-activedescendant', activeOption.id);
  activeOption.scrollIntoView?.({ block: 'nearest' });
}

function renderHotelNameSuggestions() {
  const { input, menu } = getComboboxElements();
  if (!input || !menu) return [];

  visibleSuggestionNames = getFilteredHotelNameSuggestions(input.value);
  menu.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const normalizedValue = normalizeFilterOptionKey(input.value);

  visibleSuggestionNames.forEach((name, index) => {
    const option = document.createElement('button');
    const isSelected = normalizeFilterOptionKey(name) === normalizedValue;
    option.type = 'button';
    option.id = `hotelNameSuggestion-${index}`;
    option.className = `custom-select-option hotel-name-suggestion-option${isSelected ? ' is-selected' : ''}`;
    option.dataset.value = name;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    option.tabIndex = -1;
    option.textContent = name;
    fragment.appendChild(option);
  });

  if (visibleSuggestionNames.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'hotel-name-suggestion-empty';
    emptyState.setAttribute('role', 'status');
    emptyState.textContent = input.value.trim()
      ? '没有名称建议，仍可按当前关键词筛选'
      : '暂无宾馆名称';
    fragment.appendChild(emptyState);
    activeSuggestionIndex = -1;
  } else if (activeSuggestionIndex >= visibleSuggestionNames.length) {
    activeSuggestionIndex = visibleSuggestionNames.length - 1;
  }

  menu.appendChild(fragment);
  syncActiveSuggestion();
  return visibleSuggestionNames;
}

function openHotelNameCombobox() {
  renderHotelNameSuggestions();
  syncComboboxExpandedState(true);
}

export function closeHotelNameCombobox() {
  syncComboboxExpandedState(false);
}

function selectHotelNameSuggestion(name) {
  const { input } = getComboboxElements();
  if (!input || !name) return;
  input.value = name;
  closeHotelNameCombobox();
  input.focus({ preventScroll: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setupHotelNameCombobox() {
  const { wrapper, input, toggle, menu } = getComboboxElements();
  if (!wrapper || !input || !menu || input.dataset.comboboxReady === 'true') return;
  input.dataset.comboboxReady = 'true';

  input.addEventListener('focus', openHotelNameCombobox);
  input.addEventListener('input', () => {
    activeSuggestionIndex = -1;
    renderHotelNameSuggestions();
    syncComboboxExpandedState(true);
  });
  input.addEventListener('keydown', (event) => {
    const isOpen = input.getAttribute('aria-expanded') === 'true';
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openHotelNameCombobox();
      if (visibleSuggestionNames.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      activeSuggestionIndex =
        activeSuggestionIndex < 0
          ? direction > 0
            ? 0
            : visibleSuggestionNames.length - 1
          : (activeSuggestionIndex + direction + visibleSuggestionNames.length) %
            visibleSuggestionNames.length;
      syncActiveSuggestion();
      return;
    }
    if (event.key === 'Enter' && isOpen && activeSuggestionIndex >= 0) {
      event.preventDefault();
      selectHotelNameSuggestion(visibleSuggestionNames[activeSuggestionIndex]);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeHotelNameCombobox();
      return;
    }
    if (event.key === 'Tab') closeHotelNameCombobox();
  });
  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) closeHotelNameCombobox();
    }, 0);
  });

  toggle?.addEventListener('mousedown', (event) => event.preventDefault());
  toggle?.addEventListener('click', () => {
    const isOpen = input.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeHotelNameCombobox();
      return;
    }
    input.focus({ preventScroll: true });
    if (input.getAttribute('aria-expanded') !== 'true') openHotelNameCombobox();
  });

  menu.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const option = /** @type {HTMLElement|null} */ (
      target?.closest('.hotel-name-suggestion-option') || null
    );
    if (!option?.dataset.value) return;
    event.preventDefault();
    selectHotelNameSuggestion(option.dataset.value);
  });

  renderHotelNameSuggestions();
  closeHotelNameCombobox();
}

/**
 * @param {{selectedValue?: string}} [options]
 * @returns {string}
 */
export function syncHotelNameFilterOptions(options = {}) {
  const input = /** @type {HTMLInputElement|null} */ ($('filterName'));
  const menu = /** @type {HTMLElement|null} */ ($('hotelNameSuggestions'));
  if (!input || !menu) return options.selectedValue || '';

  const selectedValue = options.selectedValue ?? input.value;
  const newOptions = buildHotelNameFilterOptions();
  const signature = newOptions.join('\x00');

  if (signature === state.hotelNameFilterOptionSignature) {
    input.value = selectedValue;
    renderHotelNameSuggestions();
    return input.value;
  }

  setHotelNameFilterOptionSignature(signature);

  input.value = selectedValue;
  renderHotelNameSuggestions();

  return input.value;
}
