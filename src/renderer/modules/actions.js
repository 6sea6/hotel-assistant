/**
 * 函数注册表 —— 解决模块间循环依赖。
 *
 * 模块在加载时将自身的「被其它模块调用」的函数注册到此处，
 * 其它模块通过 actions.xxx() 调用，无需直接 import 源模块。
 */

/**
 * @typedef {import('../../shared/contracts').AppSettings} AppSettings
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} NormalizedTemplateRecord
 */

/**
 * @typedef {{includeSettings?: boolean, invalidateCache?: boolean, verbose?: boolean, forceHotels?: boolean}} ReloadAllDataOptions
 * @typedef {{interactionFirst?: boolean}} RenderHotelListOptions
 * @typedef {{reason?: string, changedIds?: Array<EntityId|null|undefined>|Set<EntityId|null|undefined>, forceFull?: boolean, interactionFirst?: boolean}} RequestHotelListRenderOptions
 * @typedef {{selectedValue?: string, interactionFirst?: boolean}} UpdateTemplateFilterOptions
 * @typedef {{showSuccess?: boolean, interactionFirst?: boolean}} RefreshCurrentPageOptions
 */

/**
 * Core action registry populated by renderer modules during module loading.
 *
 * @typedef {object} ActionsRegistry
 * @property {(options?: RenderHotelListOptions) => void} renderHotelList
 * @property {(options?: RequestHotelListRenderOptions) => void} [requestHotelListRender]
 * @property {(id: EntityId) => void} showHotelDetails
 * @property {(id: EntityId) => void} editHotel
 * @property {(id: EntityId) => Promise<void>} deleteHotel
 * @property {(id: EntityId, currentStatus: number|boolean) => Promise<void>} toggleFavorite
 * @property {() => Promise<NormalizedHotelRecord[]>} loadHotels
 * @property {() => Promise<NormalizedTemplateRecord[]>} loadTemplates
 * @property {() => Promise<AppSettings>} loadSettings
 * @property {(options?: ReloadAllDataOptions) => Promise<{hotelsCount: number, templatesCount: number, settingsLoaded: boolean}>} reloadAllData
 * @property {(templateId: EntityId|null|undefined) => NormalizedTemplateRecord|undefined} findTemplateById
 * @property {(templateId?: EntityId|null) => void} openAddHotelModal
 * @property {() => void} renderTemplateList
 * @property {(options?: UpdateTemplateFilterOptions) => void} updateTemplateFilter
 * @property {(url?: string) => Promise<void>} openWebsite
 * @property {() => void} applySettings
 * @property {(options?: RefreshCurrentPageOptions) => Promise<void>} refreshCurrentPage
 * @property {() => Promise<void>} loadDataPath
 * @property {() => Promise<void>} loadAppIconState
 */

/** @type {ActionsRegistry} */
export const actions = /** @type {ActionsRegistry} */ ({});
