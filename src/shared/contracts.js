/**
 * Shared JSDoc contracts for core app data and IPC surfaces.
 *
 * This module intentionally exports no runtime values. Use it from JavaScript
 * files with JSDoc imports such as import('./contracts').HotelRecord.
 */

/**
 * Numeric IDs are normalized when possible, but legacy/imported records can
 * still carry string IDs.
 *
 * @typedef {number|string} EntityId
 */

/**
 * @typedef {'collect'|'refresh-data'|string} AiTaskKind
 */

/**
 * @typedef {'waiting'|'running'|'completed'|'failed'|'cancelled'|string} AiTaskQueueStatus
 */

/**
 * Snapshot of template fields copied onto a hotel.
 *
 * @typedef {object} TemplateInfo
 * @property {EntityId|null} [id]
 * @property {string} [name]
 * @property {string} [destination]
 * @property {string|null} [check_in_date]
 * @property {string|null} [check_out_date]
 * @property {number|null} [room_count]
 */

/**
 * Saved comparison template.
 *
 * @typedef {object} TemplateRecord
 * @property {EntityId|null} [id]
 * @property {string} [name]
 * @property {string} [destination]
 * @property {string|null} [check_in_date]
 * @property {string|null} [check_out_date]
 * @property {number} [room_count]
 * @property {string} [created_at]
 */

/**
 * Expanded hotel record as used by the renderer and IPC handlers.
 *
 * @typedef {object} HotelRecord
 * @property {EntityId|null} [id]
 * @property {string} [name]
 * @property {string} [address]
 * @property {string} [website]
 * @property {number|null} [total_price]
 * @property {number|null} [daily_price]
 * @property {string|null} [check_in_date]
 * @property {string|null} [check_out_date]
 * @property {number|null} [days]
 * @property {number|null} [ctrip_score]
 * @property {string} [destination]
 * @property {string} [distance]
 * @property {string} [subway_station]
 * @property {string} [subway_distance]
 * @property {string} [transport_time]
 * @property {string} [bus_route]
 * @property {string} [room_type]
 * @property {string} [original_room_type]
 * @property {number} [room_count]
 * @property {string} [room_area]
 * @property {string} [notes]
 * @property {0|1|number} [is_favorite]
 * @property {EntityId|null} [template_id]
 * @property {TemplateInfo|null} [template_info]
 * @property {string} [created_at]
 * @property {string} [updated_at]
 * @property {string} [cancel_policy]
 * @property {string} [window_status]
 */

/**
 * @typedef {Record<string, unknown> & {
 *   weight_price?: number|string,
 *   weight_score?: number|string,
 *   weight_distance?: number|string,
 *   weight_transport?: number|string,
 *   theme?: string,
 *   activeTheme?: string,
 *   language?: string,
 *   includeFourPersonRoomsForThreePersonTemplate?: boolean,
 *   aiListDesiredHotelCount?: number|string,
 *   aiListExcludeHotelTypes?: string,
 *   aiCtripPriceMin?: number|string,
 *   aiCtripPriceMax?: number|string,
 *   aiCtripStarLevels?: Array<number|string>,
 *   aiCtripSortMode?: string,
 *   aiCtripFreeCancel?: boolean,
 *   aiCtripReviewCountMin?: number|string,
 *   aiCtripScoreMin?: number|string,
 *   amapApiKey?: string,
 *   enableCollectPerfLog?: boolean,
 *   app_icon_path?: string,
 *   app_icon_file_name?: string,
 *   ai_provider_config?: Record<string, unknown>|null
 * }} AppSettings
 */

/**
 * Event emitted by the AI task backend and rendered in the console timeline.
 *
 * @typedef {Record<string, unknown> & {
 *   type?: string,
 *   message?: string,
 *   at?: string,
 *   taskId?: string,
 *   toolName?: string,
 *   details?: Record<string, unknown>|null
 * }} AiTaskEvent
 */

/**
 * Renderer console state for the current AI collection/refresh task.
 *
 * @typedef {object} AiTaskConsoleState
 * @property {boolean} [submitted]
 * @property {TemplateRecord|null} [template]
 * @property {string} [templateLabel]
 * @property {string} [hotelUrl]
 * @property {string} [taskId]
 * @property {string} [startedAt]
 * @property {string} [endedAt]
 * @property {Record<string, unknown>|null} [result]
 * @property {Record<string, unknown>|null} [collectResult]
 * @property {string|null} [error]
 * @property {string} [reply]
 * @property {AiTaskKind} [taskKind]
 * @property {boolean} [cancelled]
 * @property {string} [status]
 */

/**
 * Item stored in the renderer AI task queue.
 *
 * @typedef {object} AiTaskQueueItem
 * @property {string} [id]
 * @property {string} [displayIndex]
 * @property {string} [url]
 * @property {string} [templateId]
 * @property {string} [templateName]
 * @property {string} [templateLabel]
 * @property {string} [title]
 * @property {TemplateRecord|null} [template]
 * @property {Record<string, unknown>} [listFilters]
 * @property {Record<string, unknown>} [listUrlFilters]
 * @property {AiTaskKind} [taskKind]
 * @property {AiTaskQueueStatus} [status]
 * @property {string} [currentStep]
 * @property {string} [createdAt]
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {string} [backendTaskId]
 * @property {string} [errorMessage]
 * @property {string} [resultSummary]
 * @property {AiTaskEvent[]} [events]
 * @property {AiTaskConsoleState} [console]
 * @property {boolean} [cancelNoticeShown]
 * @property {string} [selectedId]
 */

/**
 * Standard success/error envelope used by IPC handlers.
 *
 * @template T
 * @typedef {object} IpcResult
 * @property {boolean} success
 * @property {T} [data]
 * @property {string} [error]
 * @property {boolean} [canceled]
 */

/**
 * @typedef {IpcResult<unknown> & {
 *   deletedCount?: number,
 *   affectedHotelCount?: number,
 *   affectedCount?: number
 * }} IpcMutationResult
 */

/**
 * @typedef {IpcResult<unknown> & {
 *   path?: string,
 *   oldPath?: string,
 *   deleted?: boolean,
 *   samePath?: boolean
 * }} IpcPathResult
 */

/**
 * @typedef {object} ElectronBatchAPI
 * @property {(hotels: Partial<HotelRecord>[]) => Promise<HotelRecord[]>} updateMultipleHotels
 */

/**
 * @typedef {object} ElectronAiAPI
 * @property {() => Promise<Record<string, unknown>|null>} getConfig
 * @property {() => Promise<Array<Record<string, unknown>>>} getPresets
 * @property {(config: Record<string, unknown>) => Promise<IpcResult<unknown>>} saveConfig
 * @property {(config: Record<string, unknown>) => Promise<IpcResult<unknown>>} testConnection
 * @property {(payload: Record<string, unknown>) => Promise<Record<string, unknown>>} sendChat
 * @property {(payload: Record<string, unknown>) => Promise<Record<string, unknown>>} startTask
 * @property {(payload: Record<string, unknown>) => Promise<Record<string, unknown>>} refreshHotelData
 * @property {() => Promise<IpcResult<unknown>>} cancelTask
 * @property {() => Promise<Record<string, unknown>>} getTaskStatus
 * @property {(url: string) => Promise<Record<string, unknown>>} parseCtripListUrl
 * @property {(payload: Record<string, unknown>) => Promise<string>} buildCtripListUrl
 * @property {(callback: (event: AiTaskEvent) => void) => void} onTaskEvent
 */

/**
 * Renderer-facing API exposed from preload.
 *
 * @typedef {object} ElectronAPI
 * @property {{name: string, version: string, releaseDate: string, author: string, platform: string}} appInfo
 * @property {(hotel: Partial<HotelRecord>) => Promise<HotelRecord>} addHotel
 * @property {(hotel: Partial<HotelRecord>) => Promise<HotelRecord|null>} updateHotel
 * @property {(id: EntityId) => Promise<IpcMutationResult>} deleteHotel
 * @property {(ids: EntityId[]) => Promise<IpcMutationResult>} deleteMultipleHotels
 * @property {() => Promise<HotelRecord[]>} getAllHotels
 * @property {(id: EntityId) => Promise<HotelRecord|undefined>} getHotelById
 * @property {(hotels: Partial<HotelRecord>[]) => Promise<HotelRecord[]>} updateMultipleHotels
 * @property {(template: Partial<TemplateRecord>) => Promise<TemplateRecord>} addTemplate
 * @property {(template: Partial<TemplateRecord>) => Promise<TemplateRecord|null>} updateTemplate
 * @property {(template: Partial<TemplateRecord>) => Promise<IpcMutationResult & {template?: TemplateRecord}>} updateTemplateAndSync
 * @property {(id: EntityId) => Promise<IpcMutationResult>} deleteTemplate
 * @property {() => Promise<TemplateRecord[]>} getAllTemplates
 * @property {(key: string) => Promise<unknown>} getSetting
 * @property {(key: string, value: unknown) => Promise<IpcResult<unknown>>} setSetting
 * @property {(theme: string) => Promise<IpcResult<unknown>>} applyThemeAppearance
 * @property {() => Promise<AppSettings>} getAllSettings
 * @property {() => Promise<Record<string, unknown>>} getAppIconState
 * @property {() => Promise<IpcPathResult & {activePath?: string, originalPath?: string, fileName?: string, state?: Record<string, unknown>}>} chooseAppIcon
 * @property {() => Promise<IpcResult<unknown> & {state?: Record<string, unknown>}>} resetAppIcon
 * @property {() => Promise<IpcResult<unknown> & {settings?: AppSettings, iconState?: Record<string, unknown>}>} resetAllSettings
 * @property {() => Promise<IpcPathResult & {hotelCount?: number, templateCount?: number, meta?: Record<string, unknown>}>} exportData
 * @property {(mode?: 'replace'|'append'|string) => Promise<IpcResult<unknown> & {mode?: string, hotelCount?: number, templateCount?: number, skippedHotelCount?: number, skippedTemplateCount?: number, meta?: Record<string, unknown>}>} importData
 * @property {(imageBuffer: string) => Promise<IpcPathResult>} exportRankingImage
 * @property {() => Promise<unknown>} openCtrip
 * @property {() => Promise<unknown>} openFliggy
 * @property {(url: string) => Promise<unknown>} openExternal
 * @property {() => Promise<string>} getManualContent
 * @property {() => Promise<string>} getDataPath
 * @property {() => Promise<IpcResult<unknown>>} showDataInFolder
 * @property {() => Promise<IpcPathResult>} changeDataPath
 * @property {ElectronBatchAPI} batch
 * @property {(callback: (...args: unknown[]) => void) => void} onMenuExportData
 * @property {(callback: (...args: unknown[]) => void) => void} onMenuImportData
 * @property {() => Promise<unknown>} minimizeWindow
 * @property {() => Promise<Record<string, unknown>>} toggleMaximizeWindow
 * @property {() => Promise<unknown>} closeWindow
 * @property {() => Promise<Record<string, unknown>>} getWindowState
 * @property {(callback: (state: Record<string, unknown>) => void) => void} onWindowStateChanged
 * @property {ElectronAiAPI} ai
 * @property {(channel: string) => void} removeAllListeners
 * @property {(pattern?: string) => void} invalidateRendererCache
 * @property {(callback: (data: Record<string, unknown>) => void) => void} onTemplateUpdated
 */

module.exports = {};
