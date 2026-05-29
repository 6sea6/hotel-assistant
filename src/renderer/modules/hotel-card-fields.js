/**
 * 宾馆卡片字段定义 —— 定义卡片视图中可展示的字段及其渲染逻辑。
 */

import {
  escapeHtml,
  escapeHtmlWithLineBreaks,
  hasDisplayValue
} from './dom-helpers.js';

/**
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').TemplateInfo} TemplateInfo
 */

/**
 * @typedef {object} HotelCardFieldDef
 * @property {string} key
 * @property {string} label
 * @property {'compact'|'full'|'header'|'footer'|'action'} group
 * @property {(hotel: NormalizedHotelRecord, helpers: FieldRenderHelpers) => string|null} getValue
 * @property {(value: string, hotel: NormalizedHotelRecord, helpers: FieldRenderHelpers) => string} render
 * @property {string} [inheritedTemplateField]
 */

/**
 * @typedef {object} FieldRenderHelpers
 * @property {(text: string) => string} escapeHtml
 * @property {(text: string) => string} escapeHtmlWithLineBreaks
 * @property {(value: unknown) => boolean} hasDisplayValue
 * @property {(dateStr: string) => string} formatDateChinese
 * @property {(count: number) => string} getRoomCountText
 * @property {(station: string, distance: string) => string} formatSubwayInfo
 * @property {(field: string) => boolean} isFromTemplate
 */

/** @type {FieldRenderHelpers} */
let _helpers = null;

/**
 * @param {FieldRenderHelpers} helpers
 */
export function setFieldRenderHelpers(helpers) {
  _helpers = helpers;
}

export const SUPPORTED_HOTEL_CARD_FIELD_KEYS = Object.freeze(new Set([
  'original_room_type',
  'address',
  'website',
  'total_price',
  'daily_price',
  'ctrip_score',
  'destination',
  'distance',
  'subway',
  'transport_time',
  'bus_route',
  'room_type',
  'room_count',
  'room_area',
  'days',
  'check_in_date',
  'check_out_date',
  'notes',
  'template',
  'cancel_policy',
  'window_status'
]));

export const DEFAULT_HOTEL_CARD_VISIBLE_FIELDS = Object.freeze([
  'original_room_type',
  'address',
  'website',
  'total_price',
  'daily_price',
  'ctrip_score',
  'distance',
  'subway',
  'transport_time',
  'bus_route',
  'room_type',
  'notes',
  'template'
]);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeHotelCardVisibleFields(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_HOTEL_CARD_VISIBLE_FIELDS];
  }
  const allowed = new Set(SUPPORTED_HOTEL_CARD_FIELD_KEYS);
  return [...new Set(value.filter((key) => typeof key === 'string' && allowed.has(key)))];
}

/** @type {HotelCardFieldDef[]} */
export const HOTEL_CARD_FIELDS = [
  {
    key: 'original_room_type',
    label: '原始房型',
    group: 'header',
    getValue: (hotel) => hotel.original_room_type || null,
    render: (value) => `<div class="hotel-original-room hotel-card-original-room">原始房型：${escapeHtml(value)}</div>`
  },
  {
    key: 'address',
    label: '地址',
    group: 'header',
    getValue: (hotel) => hotel.address || null,
    render: (value) => `<div class="hotel-address hotel-card-address">📍 ${escapeHtml(value)}</div>`
  },
  {
    key: 'website',
    label: '网址',
    group: 'header',
    getValue: (hotel) => hotel.website || null,
    render: (value) =>
      `<div class="hotel-website hotel-card-website"><span class="hotel-website-icon">🌐</span><a href="#" data-url="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(value)}</a></div>`
  },
  {
    key: 'total_price',
    label: '总价格',
    group: 'compact',
    getValue: (hotel) => (hotel.total_price ? String(hotel.total_price) : null),
    render: (value) =>
      `<div class="info-item"><div class="info-label">总价格</div><div class="info-value price">¥${escapeHtml(value)}</div></div>`
  },
  {
    key: 'daily_price',
    label: '日均价格',
    group: 'compact',
    getValue: (hotel) => (hotel.daily_price ? String(hotel.daily_price) : null),
    render: (value) =>
      `<div class="info-item"><div class="info-label">日均价格</div><div class="info-value price">¥${escapeHtml(value)}</div></div>`
  },
  {
    key: 'ctrip_score',
    label: '携程评分',
    group: 'compact',
    getValue: (hotel) =>
      hotel.ctrip_score !== undefined && hotel.ctrip_score !== null
        ? String(hotel.ctrip_score.toFixed(1))
        : null,
    render: (value) =>
      `<div class="info-item"><div class="info-label">携程评分</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'destination',
    label: '目的地',
    group: 'compact',
    inheritedTemplateField: 'destination',
    getValue: (hotel, helpers) => {
      if (!hotel.destination) return null;
      if (helpers.isFromTemplate('destination')) return null;
      return hotel.destination;
    },
    render: (value) =>
      `<div class="info-item"><div class="info-label">目的地</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'distance',
    label: '距离',
    group: 'compact',
    getValue: (hotel) => (hasDisplayValue(hotel.distance) ? `${hotel.distance} 公里` : null),
    render: (value) =>
      `<div class="info-item"><div class="info-label">距离</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'subway',
    label: '最近地铁站',
    group: 'compact',
    getValue: (hotel, helpers) => {
      if (!hasDisplayValue(hotel.subway_station) && !hasDisplayValue(hotel.subway_distance))
        return null;
      return helpers.formatSubwayInfo(hotel.subway_station, hotel.subway_distance);
    },
    render: (value) =>
      `<div class="info-item"><div class="info-label">最近地铁站</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'transport_time',
    label: '公共交通',
    group: 'compact',
    getValue: (hotel) => (hotel.transport_time ? `${hotel.transport_time} 分钟` : null),
    render: (value) =>
      `<div class="info-item"><div class="info-label">公共交通</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'bus_route',
    label: '公交路线',
    group: 'full',
    getValue: (hotel) => (hasDisplayValue(hotel.bus_route) ? hotel.bus_route : null),
    render: (value) =>
      `<div class="info-item info-item-full info-item-route"><div class="info-label">公交路线</div><div class="info-value">${escapeHtmlWithLineBreaks(value)}</div></div>`
  },
  {
    key: 'room_type',
    label: '房间类型',
    group: 'compact',
    getValue: (hotel) => hotel.room_type || null,
    render: (value) =>
      `<div class="info-item"><div class="info-label">房间类型</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'room_count',
    label: '入住人数',
    group: 'compact',
    inheritedTemplateField: 'room_count',
    getValue: (hotel, helpers) => {
      if (!hotel.room_count) return null;
      if (helpers.isFromTemplate('room_count')) return null;
      return helpers.getRoomCountText(hotel.room_count);
    },
    render: (value) =>
      `<div class="info-item"><div class="info-label">入住人数</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'room_area',
    label: '房间面积',
    group: 'compact',
    getValue: (hotel) => (hotel.room_area ? `${hotel.room_area} ㎡` : null),
    render: (value) =>
      `<div class="info-item"><div class="info-label">房间面积</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'days',
    label: '住宿天数',
    group: 'compact',
    getValue: (hotel) => (hotel.days ? `${hotel.days}天` : null),
    render: (value) =>
      `<div class="info-item"><div class="info-label">住宿天数</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'check_in_date',
    label: '入住日期',
    group: 'compact',
    inheritedTemplateField: 'check_in_date',
    getValue: (hotel, helpers) => {
      if (!hotel.check_in_date || !hotel.check_out_date) return null;
      if (helpers.isFromTemplate('check_in_date')) return null;
      return helpers.formatDateChinese(hotel.check_in_date);
    },
    render: (value) =>
      `<div class="info-item"><div class="info-label">入住日期</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'check_out_date',
    label: '离店日期',
    group: 'compact',
    inheritedTemplateField: 'check_out_date',
    getValue: (hotel, helpers) => {
      if (!hotel.check_out_date) return null;
      if (helpers.isFromTemplate('check_out_date')) return null;
      return helpers.formatDateChinese(hotel.check_out_date);
    },
    render: (value) =>
      `<div class="info-item"><div class="info-label">离店日期</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'notes',
    label: '备注',
    group: 'footer',
    getValue: (hotel) => (hotel.notes ? hotel.notes : null),
    render: (value) => `<div class="hotel-notes">📝 ${escapeHtml(value)}</div>`
  },
  {
    key: 'template',
    label: '模板',
    group: 'action',
    getValue: (hotel) => {
      if (!hotel.template_info) return null;
      return hotel.template_info.name || null;
    },
    render: (value) => `<div class="hotel-template-badge">${escapeHtml(value)}</div>`
  },
  {
    key: 'cancel_policy',
    label: '取消政策',
    group: 'compact',
    getValue: (hotel) => hotel.cancel_policy || null,
    render: (value) =>
      `<div class="info-item"><div class="info-label">取消政策</div><div class="info-value">${escapeHtml(value)}</div></div>`
  },
  {
    key: 'window_status',
    label: '房态/窗口状态',
    group: 'compact',
    getValue: (hotel) => hotel.window_status || null,
    render: (value) =>
      `<div class="info-item"><div class="info-label">房态</div><div class="info-value">${escapeHtml(value)}</div></div>`
  }
];

const FIELD_MAP = new Map(HOTEL_CARD_FIELDS.map((field) => [field.key, field]));

/**
 * @param {string} key
 * @returns {HotelCardFieldDef|undefined}
 */
export function getFieldDef(key) {
  return FIELD_MAP.get(key);
}

/**
 * @param {NormalizedHotelRecord} hotel
 * @param {string[]} visibleKeys
 * @param {FieldRenderHelpers} helpers
 * @returns {{headerItems: string[], headerFieldItems: Array<{key: string, html: string}>, compactItems: string[], fullItems: string[], footerItems: string[], actionItems: string[]}}
 */
export function renderCardFields(hotel, visibleKeys, helpers) {
  const headerItems = [];
  const headerFieldItems = [];
  const compactItems = [];
  const fullItems = [];
  const footerItems = [];
  const actionItems = [];

  for (const key of visibleKeys) {
    const field = FIELD_MAP.get(key);
    if (!field) continue;

    const value = field.getValue(hotel, helpers);
    if (value === null || value === undefined) continue;

    const html = field.render(value, hotel, helpers);
    if (!html) continue;

    switch (field.group) {
      case 'header':
        headerItems.push(html);
        headerFieldItems.push({ key, html });
        break;
      case 'full':
        fullItems.push(html);
        break;
      case 'footer':
        footerItems.push(html);
        break;
      case 'action':
        actionItems.push(html);
        break;
      case 'compact':
      default:
        compactItems.push(html);
        break;
    }
  }

  return { headerItems, headerFieldItems, compactItems, fullItems, footerItems, actionItems };
}
