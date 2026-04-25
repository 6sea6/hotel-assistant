const path = require('path');
const { requireSharedCompareAppModule } = require('./shared-compare-app');
const { BASE_COMPARE_APP_SETTINGS, DEFAULT_COMPARE_APP_FILES } = requireSharedCompareAppModule('constants.js');
const { PROMPT_CONTRACT } = requireSharedCompareAppModule('prompt-contract.js');

const HOTEL_EDITABLE_FIELDS = [
  { key: 'name', label: '宾馆名称', type: 'string', required: true, description: '必填，宾馆名称' },
  { key: 'address', label: '地址', type: 'string', required: false, description: '宾馆地址或商圈位置' },
  { key: 'website', label: '网址', type: 'string', required: false, description: '官网、携程或详情页链接' },
  { key: 'total_price', label: '总价', type: 'number|null', required: false, description: '总价格数字' },
  { key: 'daily_price', label: '日均价', type: 'number|null', required: false, description: '日均价格数字' },
  { key: 'check_in_date', label: '入住日期', type: 'YYYY-MM-DD|null', required: false, description: '入住日期' },
  { key: 'check_out_date', label: '离店日期', type: 'YYYY-MM-DD|null', required: false, description: '离店日期' },
  { key: 'days', label: '住宿天数', type: 'number|null', required: false, description: '住宿天数' },
  { key: 'ctrip_score', label: '携程评分', type: 'number|null', required: false, description: '0-5 分评分数字' },
  { key: 'destination', label: '目的地', type: 'string', required: false, description: '本次出行核心目的地' },
  { key: 'distance', label: '距离', type: 'string', required: false, description: '到目的地的距离数字字符串' },
  { key: 'subway_station', label: '最近地铁站', type: 'string', required: false, description: '距离宾馆最近的地铁站名称，若无较近地铁站可留空' },
  { key: 'subway_distance', label: '最近地铁站距离', type: 'string', required: false, description: '到最近地铁站的距离数字字符串，0 表示无较近地铁站' },
  { key: 'transport_time', label: '公共交通时间', type: 'string', required: false, description: '到目的地的公共交通分钟数字字符串' },
  { key: 'bus_route', label: '公交路线', type: 'string', required: false, description: '到目的地的公交或地铁换乘路线说明' },
  { key: 'room_type', label: '房型', type: 'string', required: false, description: '如大床房、双床房、大床房/双床房、家庭房、三床房' },
  { key: 'original_room_type', label: '原始房型名', type: 'string', required: false, description: '平台原始展示房型名，如三人间、商务双床房、豪华大床房' },
  { key: 'room_count', label: '入住人数', type: 'number', required: false, description: '1、2、3、4，默认 1' },
  { key: 'room_area', label: '房间面积', type: 'string', required: false, description: '面积数字字符串' },
  { key: 'notes', label: '备注', type: 'string', required: false, description: '早餐、退改、税费、接驳、优缺点等补充信息' },
  { key: 'is_favorite', label: '收藏状态', type: '0|1', required: false, description: '0 表示否，1 表示是' },
  { key: 'template_id', label: '模板 ID', type: 'number|string|null', required: false, description: '匹配现有模板时写入' },
  { key: 'template_info', label: '模板快照', type: 'object|null', required: false, description: '与匹配模板一致的模板信息快照' }
];

const HOTEL_SYSTEM_FIELDS = [
  { key: 'id', label: '宾馆 ID', type: 'number', description: '系统主键，新增时由程序生成' },
  { key: 'created_at', label: '创建时间', type: 'ISO datetime', description: '系统自动生成' },
  { key: 'updated_at', label: '更新时间', type: 'ISO datetime', description: '系统自动更新' }
];

const TEMPLATE_FIELDS = [
  { key: 'id', label: '模板 ID', type: 'number', description: '模板主键' },
  { key: 'name', label: '模板名称', type: 'string', description: '模板名称' },
  { key: 'destination', label: '目的地', type: 'string', description: '模板对应目的地' },
  { key: 'check_in_date', label: '入住日期', type: 'YYYY-MM-DD|null', description: '模板入住日期' },
  { key: 'check_out_date', label: '离店日期', type: 'YYYY-MM-DD|null', description: '模板离店日期' },
  { key: 'room_count', label: '入住人数', type: 'number', description: '模板人数（当前采集仅支持 1-3）' },
  { key: 'created_at', label: '创建时间', type: 'ISO datetime', description: '模板创建时间' }
];

const TEMPLATE_INFO_FIELDS = [
  { key: 'id', label: '模板 ID', type: 'number|string', description: '来源模板 ID' },
  { key: 'name', label: '模板名称', type: 'string', description: '来源模板名称' },
  { key: 'destination', label: '目的地', type: 'string', description: '来源模板目的地' },
  { key: 'check_in_date', label: '入住日期', type: 'YYYY-MM-DD|null', description: '来源模板入住日期' },
  { key: 'check_out_date', label: '离店日期', type: 'YYYY-MM-DD|null', description: '来源模板离店日期' },
  { key: 'room_count', label: '入住人数', type: 'number', description: '来源模板人数（当前采集仅支持 1-3）' }
];

// 应用常量
const APP_CONFIG = {
  NAME: '宾馆比较助手',
  VERSION: '6.6',
  RELEASE_DATE: '2026-04-16',
  AUTHOR: 'Sea',
  APP_USER_MODEL_ID: 'com.hotel.comparison.desktop',

  // 窗口配置
  WINDOW: {
    WIDTH: 1400,
    HEIGHT: 900,
    MIN_WIDTH: 1024,
    MIN_HEIGHT: 768,
    BACKGROUND_COLOR: '#EEF4F9',
    TITLE: '宾馆比较助手'
  },

  // 数据存储默认值
  STORE_DEFAULTS: {
    hotels: [],
    templates: [],
    settings: {
      ...BASE_COMPARE_APP_SETTINGS,
      app_icon_path: '',
      app_icon_file_name: ''
    }
  },

  // 缓存配置
  CACHE_TTL: 5000,

  // 文件扩展名
  FILE_EXTENSIONS: {
    JSON: 'json',
    PNG: 'png',
    JPEG: ['jpg', 'jpeg']
  },

  // 外部链接
  EXTERNAL_LINKS: {
    CTRIP: 'https://www.ctrip.com/',
    FLIGGY: 'https://www.fliggy.com/'
  }
};

// 路径配置
const getPaths = () => {
  const electron = require('electron');
  return {
    // 数据文件夹相关
    POINTER_FILE: require('path').join(electron.app.getPath('appData'), DEFAULT_COMPARE_APP_FILES.pointerFileName),
    DATA_FOLDER_NAME: DEFAULT_COMPARE_APP_FILES.appFolderName,

    // 应用内部路径
    PRELOAD_SCRIPT: require('path').join(__dirname, 'preload.js'),
    RENDERER_HTML: require('path').join(__dirname, '../renderer/index.html'),
    DEFAULT_APP_ICON: require('path').join(__dirname, '../../build/icon.ico'),
    FALLBACK_APP_ICON: require('path').join(__dirname, '../../build/uninstallerIcon.ico'),
    PACKAGED_DEFAULT_ICON_NAME: 'icon.ico',
    PACKAGED_FALLBACK_ICON_NAME: 'uninstallerIcon.ico',

    // 数据文件
    STORE_NAME: path.parse(DEFAULT_COMPARE_APP_FILES.storeFileName).name,
    PROMPTS_FILE: PROMPT_CONTRACT.compareAppPromptsFileName
  };
};

module.exports = {
  APP_CONFIG,
  getPaths,
  HOTEL_EDITABLE_FIELDS,
  HOTEL_SYSTEM_FIELDS,
  TEMPLATE_FIELDS,
  TEMPLATE_INFO_FIELDS
};
