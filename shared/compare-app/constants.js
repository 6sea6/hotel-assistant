const BASE_COMPARE_APP_SETTINGS = Object.freeze({
  theme: 'totoro-blue',
  language: 'zh-CN',
  includeFourPersonRoomsForThreePersonTemplate: false,
  aiListDesiredHotelCount: 10,
  aiCtripPriceMin: '',
  aiCtripPriceMax: '',
  aiCtripStarLevels: [],
  aiCtripSortMode: '',
  aiCtripFreeCancel: false,
  aiCtripReviewCountMin: '',
  aiCtripScoreMin: '',
  aiCtripAccommodationTypeMode: 'include',
  aiCtripAccommodationTypes: [],
  aiCtripRoomTypes: [],
  aiCtripRoomFeatures: [],
  aiCtripFeatureThemes: [],
  amapApiKey: '',
  enableCollectPerfLog: false,
  collectBrowser: 'edge',
  collectBatchConcurrency: 1,
  hotelCardVisibleFields: [
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
  ]
});

const DEPRECATED_COMPARE_APP_SETTING_KEYS = Object.freeze([
  'autoMatchTemplate',
  'weight_price',
  'weight_score',
  'weight_distance',
  'weight_transport',
  'aiListMinScore',
  'aiListExcludeKeywords',
  'aiListExcludeHotelTypes',
  'aiListMaxPages'
]);

const DEFAULT_COMPARE_APP_FILES = Object.freeze({
  appFolderName: '宾馆比较助手',
  pointerFileName: 'hotel-app-pointer.json',
  storeFileName: 'hotel-data.json'
});

function createBaseCompareAppStore() {
  return {
    hotels: [],
    templates: [],
    settings: {
      ...BASE_COMPARE_APP_SETTINGS
    }
  };
}

module.exports = {
  BASE_COMPARE_APP_SETTINGS,
  DEPRECATED_COMPARE_APP_SETTING_KEYS,
  DEFAULT_COMPARE_APP_FILES,
  createBaseCompareAppStore
};
