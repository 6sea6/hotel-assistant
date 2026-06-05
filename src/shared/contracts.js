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
 * Renderer-visible AI task kind. The first two values are the known queue
 * modes; string keeps compatibility with backend experiments.
 *
 * @typedef {'collect'|'refresh-data'|string} AiTaskKind
 */

/**
 * Renderer-visible AI task queue status. Known values are listed, while string
 * keeps older or backend-specific states type-compatible.
 *
 * @typedef {'waiting'|'running'|'completed'|'failed'|'cancelled'|string} AiTaskQueueStatus
 */

/**
 * URL-level filters understood by the Ctrip list URL parser/builder.
 *
 * @typedef {object} CtripUrlFilterSettings
 * @property {number|null} [priceMin]
 * @property {number|'max'|null} [priceMax]
 * @property {number[]} [starLevels]
 * @property {'popularity'|'price_low'|'review_high'|string|null} [sortMode]
 * @property {boolean} [freeCancel]
 * @property {100|200|500|number|null} [reviewCountMin]
 * @property {4|4.5|4.7|number|null} [ctripScoreMin]
 */

/**
 * Renderer form filters that are passed to the AI collection backend before
 * writing a hotel record.
 *
 * @typedef {object} AiListFilters
 * @property {number} [desiredHotelCount]
 * @property {string[]} [excludeHotelTypes]
 */

/**
 * Parsed or generated Ctrip list URL filters. Extra fields cover parser
 * metadata that is useful to the renderer but not part of the canonical
 * settings shape.
 *
 * @typedef {CtripUrlFilterSettings & {
 *   knownSettings?: CtripUrlFilterSettings,
 *   detectedKnownFilterKeys?: string[],
 *   listFilterParts?: string[],
 *   nativeFilters?: Record<string, unknown>
 * }} AiListUrlFilters
 */

/**
 * @typedef {Record<string, unknown> & {
 *   id?: string,
 *   status?: AiTaskQueueStatus,
 *   startedAt?: string,
 *   finishedAt?: string,
 *   events?: AiTaskEvent[]
 * }} AiTaskBackendStatus
 */

/**
 * @typedef {Record<string, unknown> & {
 *   success?: boolean,
 *   hotelName?: string,
 *   eligibleCount?: number|string,
 *   outputPath?: string,
 *   writeResult?: unknown,
 *   latestApplyResult?: Record<string, unknown>
 * }} AiCollectResult
 */

/**
 * @typedef {Record<string, unknown> & {
 *   name?: string,
 *   result?: AiCollectResult|Record<string, unknown>|null,
 *   error?: string
 * }} AiToolResult
 */

/**
 * Payload sent from the renderer AI assistant to the backend task runner.
 *
 * @typedef {Record<string, unknown> & {
 *   templateId?: string,
 *   templateName?: string,
 *   url?: string,
 *   listFilters?: AiListFilters,
 *   listUrlFilters?: AiListUrlFilters,
 *   desiredHotelCount?: number,
 *   excludeHotelTypes?: string[],
 *   amapKey?: string,
 *   priceMin?: number|null,
 *   priceMax?: number|'max'|null,
 *   starLevels?: number[],
 *   sortMode?: string|null,
 *   freeCancel?: boolean,
 *   reviewCountMin?: number|null,
 *   ctripScoreMin?: number|null,
 *   enableCollectPerfLog?: boolean,
 *   batchConcurrency?: number
 * }} AiTaskPayload
 */

/**
 * Backend result returned by collect/refresh AI tasks. Tool and write result
 * payloads remain intentionally wide while common renderer fields are named.
 *
 * @typedef {Record<string, unknown> & {
 *   success?: boolean,
 *   message?: string,
 *   error?: string,
 *   taskId?: string,
 *   taskStatus?: AiTaskBackendStatus,
 *   collectResult?: AiCollectResult|Record<string, unknown>|null,
 *   result?: AiCollectResult|Record<string, unknown>|null,
 *   toolResults?: AiToolResult[],
 *   running?: boolean,
 *   status?: AiTaskQueueStatus,
 *   events?: AiTaskEvent[],
 *   cancelled?: boolean
 * }} AiTaskBackendResult
 */

/**
 * Compatibility alias for call sites that use the shorter result name.
 *
 * @typedef {AiTaskBackendResult} AiTaskResult
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
 * Template payload before normalization. Used for imports, legacy store data,
 * renderer form payloads, and external collection input.
 *
 * @typedef {object} RawTemplateRecord
 * @property {EntityId|null} [id]
 * @property {string|null} [name]
 * @property {string|null} [destination]
 * @property {string|null} [check_in_date]
 * @property {string|null} [check_out_date]
 * @property {number|string|null} [room_count]
 * @property {string|null} [created_at]
 */

/**
 * Template after normalizeTemplatePayload().
 *
 * @typedef {object} NormalizedTemplateRecord
 * @property {EntityId|null} [id]
 * @property {string} name
 * @property {string} destination
 * @property {string|null} check_in_date
 * @property {string|null} check_out_date
 * @property {number} room_count
 * @property {string} created_at
 */

/**
 * Hotel payload before normalization. Used for imports, legacy store data,
 * renderer form payloads, and external collection input.
 *
 * @typedef {object} RawHotelRecord
 * @property {EntityId|null} [id]
 * @property {string|null} [name]
 * @property {string|null} [address]
 * @property {string|null} [website]
 * @property {number|string|null} [total_price]
 * @property {number|string|null} [daily_price]
 * @property {string|null} [check_in_date]
 * @property {string|null} [check_out_date]
 * @property {number|string|null} [days]
 * @property {number|string|null} [ctrip_score]
 * @property {string|null} [destination]
 * @property {string|null} [distance]
 * @property {string|null} [subway_station]
 * @property {string|null} [subway_distance]
 * @property {string|null} [transport_time]
 * @property {string|null} [bus_route]
 * @property {string|null} [room_type]
 * @property {string|null} [original_room_type]
 * @property {number|string|null} [room_count]
 * @property {string|null} [room_area]
 * @property {string|null} [notes]
 * @property {0|1|number|string|boolean|null} [is_favorite]
 * @property {EntityId|null} [template_id]
 * @property {TemplateInfo|null} [template_info]
 * @property {string|null} [created_at]
 * @property {string|null} [updated_at]
 * @property {string|null} [cancel_policy]
 * @property {string|null} [window_status]
 */

/**
 * Hotel after normalizeHotelPayload() and after store expansion.
 *
 * @typedef {object} NormalizedHotelRecord
 * @property {EntityId|null} [id]
 * @property {string} name
 * @property {string} address
 * @property {string} website
 * @property {number|null} total_price
 * @property {number|null} daily_price
 * @property {string|null} check_in_date
 * @property {string|null} check_out_date
 * @property {number|null} days
 * @property {number|null} ctrip_score
 * @property {string} destination
 * @property {string} distance
 * @property {string} subway_station
 * @property {string} subway_distance
 * @property {string} transport_time
 * @property {string} bus_route
 * @property {string} room_type
 * @property {string} original_room_type
 * @property {number} room_count
 * @property {string} room_area
 * @property {string} notes
 * @property {0|1} is_favorite
 * @property {EntityId|null} template_id
 * @property {TemplateInfo|null} template_info
 * @property {string|null} [created_at]
 * @property {string|null} [updated_at]
 * @property {string|null} [cancel_policy]
 * @property {string|null} [window_status]
 * @property {{
 *   nameKey: string,
 *   totalPriceNumber: number|null,
 *   dailyPriceNumber: number|null,
 *   scoreNumber: number|null,
 *   distanceNumber: number|null,
 *   subwayDistanceNumber: number|null,
 *   transportTimeNumber: number|null,
 *   roomTypeKey: string,
 *   originalRoomTypeKey: string,
 *   hotelIdentityKey: string
 * }} [_derived] Renderer-only derived cache; stripped before IPC writes.
 */

/**
 * Compatibility alias for existing JSDoc call sites that still accept raw or
 * partially populated hotel data.
 *
 * @typedef {RawHotelRecord} HotelRecord
 */

/**
 * Compatibility alias for existing JSDoc call sites that still accept raw or
 * partially populated template data.
 *
 * @typedef {RawTemplateRecord} TemplateRecord
 */

/**
 * @typedef {Record<string, unknown> & {
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
 *   collectBrowser?: 'edge'|'360'|string,
 *   collectBatchConcurrency?: number|string,
 *   app_icon_path?: string,
 *   app_icon_file_name?: string,
 *   ai_provider_config?: Record<string, unknown>|null,
 *   hotelCardVisibleFields?: string[]
 * }} AppSettings
 */

/**
 * Event emitted by the AI task backend and rendered in the console timeline.
 *
 * @typedef {Record<string, unknown> & {
 *   type?: string,
 *   message?: string,
 *   at?: string,
 *   timestamp?: string,
 *   taskId?: string,
 *   toolName?: string,
 *   details?: Record<string, unknown>|null,
 *   status?: AiTaskQueueStatus,
 *   level?: string,
 *   hotelName?: string,
 *   currentStep?: string,
 *   result?: Record<string, unknown>|string|null
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
 * @property {AiTaskBackendResult|Record<string, unknown>|null} [result]
 * @property {AiCollectResult|Record<string, unknown>|null} [collectResult]
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
 * @property {AiListFilters} [listFilters]
 * @property {AiListUrlFilters} [listUrlFilters]
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
 * @property {AiTaskBackendResult|null} [result]
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
 *   affectedCount?: number,
 *   affectedHotels?: NormalizedHotelRecord[]
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
 * @property {(hotels: Partial<RawHotelRecord>[]) => Promise<NormalizedHotelRecord[]>} updateMultipleHotels
 */

/**
 * @callback IpcUnsubscribe
 * @returns {void}
 */

/**
 * @typedef {object} ElectronAiAPI
 * @property {() => Promise<Record<string, unknown>|null>} getConfig
 * @property {() => Promise<Array<Record<string, unknown>>>} getPresets
 * @property {(config: Record<string, unknown>) => Promise<IpcResult<unknown>>} saveConfig
 * @property {(config: Record<string, unknown>) => Promise<IpcResult<unknown>>} testConnection
 * @property {(payload: Record<string, unknown>) => Promise<Record<string, unknown>>} sendChat
 * @property {(payload: AiTaskPayload) => Promise<AiTaskBackendResult>} startTask
 * @property {(payload: Partial<AiTaskPayload>) => Promise<AiTaskBackendResult>} refreshHotelData
 * @property {() => Promise<IpcResult<unknown>>} cancelTask
 * @property {() => Promise<AiTaskBackendResult>} getTaskStatus
 * @property {(url: string) => Promise<AiListUrlFilters>} parseCtripListUrl
 * @property {(payload: {baseUrl: string, settings: CtripUrlFilterSettings}) => Promise<string>} buildCtripListUrl
 * @property {(callback: (event: AiTaskEvent) => void) => IpcUnsubscribe} onTaskEvent
 */

/**
 * Renderer-facing API exposed from preload.
 *
 * @typedef {object} ElectronAPI
 * @property {{name: string, version: string, releaseDate: string, author: string, platform: string}} appInfo
 * @property {(hotel: Partial<RawHotelRecord>) => Promise<NormalizedHotelRecord>} addHotel
 * @property {(hotel: Partial<RawHotelRecord>) => Promise<NormalizedHotelRecord|null>} updateHotel
 * @property {(id: EntityId) => Promise<IpcMutationResult>} deleteHotel
 * @property {(ids: EntityId[]) => Promise<IpcMutationResult>} deleteMultipleHotels
 * @property {() => Promise<NormalizedHotelRecord[]>} getAllHotels
 * @property {() => Promise<{revision: number, count: number, loaded: boolean, dirty: boolean}>} getHotelsMeta
 * @property {() => Promise<{revision: number, count: number}>} getHotelsRevision
 * @property {() => Promise<{revision: number, count: number, hotels: NormalizedHotelRecord[]}>} getAllHotelsWithMeta
 * @property {(id: EntityId) => Promise<NormalizedHotelRecord|undefined>} getHotelById
 * @property {(hotels: Partial<RawHotelRecord>[]) => Promise<NormalizedHotelRecord[]>} updateMultipleHotels
 * @property {(hotels: Partial<RawHotelRecord>[]) => Promise<IpcResult<unknown> & {addedCount?: number, hotels?: NormalizedHotelRecord[]}>} addMultipleHotels
 * @property {(hotels: Partial<RawHotelRecord>[], options?: {matchByBusinessKey?: boolean}) => Promise<IpcResult<unknown> & {addedCount?: number, updatedCount?: number, hotels?: NormalizedHotelRecord[], added?: NormalizedHotelRecord[], updated?: NormalizedHotelRecord[]}>} upsertMultipleHotels
 * @property {(template: Partial<RawTemplateRecord>) => Promise<NormalizedTemplateRecord>} addTemplate
 * @property {(template: Partial<RawTemplateRecord>) => Promise<NormalizedTemplateRecord|null>} updateTemplate
 * @property {(template: Partial<RawTemplateRecord>) => Promise<IpcMutationResult & {template?: NormalizedTemplateRecord}>} updateTemplateAndSync
 * @property {(id: EntityId) => Promise<IpcMutationResult>} deleteTemplate
 * @property {() => Promise<NormalizedTemplateRecord[]>} getAllTemplates
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
 * @property {(callback: (...args: unknown[]) => void) => IpcUnsubscribe} onMenuExportData
 * @property {(callback: (...args: unknown[]) => void) => IpcUnsubscribe} onMenuImportData
 * @property {() => Promise<unknown>} minimizeWindow
 * @property {() => Promise<Record<string, unknown>>} toggleMaximizeWindow
 * @property {() => Promise<unknown>} closeWindow
 * @property {() => Promise<Record<string, unknown>>} getWindowState
 * @property {(callback: (state: Record<string, unknown>) => void) => IpcUnsubscribe} onWindowStateChanged
 * @property {ElectronAiAPI} ai
 * @property {(channel: string) => void} removeAllListeners
 * @property {(pattern?: string) => void} invalidateRendererCache
 * @property {(callback: (data: IpcMutationResult & {templateId?: EntityId, template?: NormalizedTemplateRecord}) => void) => IpcUnsubscribe} onTemplateUpdated
 */

module.exports = {};
