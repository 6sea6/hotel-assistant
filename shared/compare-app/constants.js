const BASE_COMPARE_APP_SETTINGS = Object.freeze({
  weight_price: 0.25,
  weight_score: 0.35,
  weight_distance: 0.2,
  weight_transport: 0.2,
  theme: 'totoro-blue',
  language: 'zh-CN',
  includeFourPersonRoomsForThreePersonTemplate: false
});

const DEFAULT_COMPARE_APP_FILES = Object.freeze({
  appFolderName: '宾馆比较助手',
  pointerFileName: 'hotel-app-pointer.json',
  storeFileName: 'hotel-data.json',
  promptsFileName: 'ai-prompts.json'
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
  DEFAULT_COMPARE_APP_FILES,
  createBaseCompareAppStore
};
