const { hasNormalizedValueChanged } = require('../normalization-utils');
const { allocateUniqueId, getIdKey, idsEqual } = require('../../shared/id-utils');

/**
 * @typedef {import('../../shared/contracts').RawTemplateRecord} RawTemplateRecord
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} NormalizedTemplateRecord
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 *
 * @typedef {{get: (key: string) => unknown, set: (key: string, value: unknown) => void}} RepositoryStore
 * @typedef {(template?: Partial<RawTemplateRecord>, existingTemplate?: Partial<RawTemplateRecord>) => NormalizedTemplateRecord} NormalizeTemplatePayload
 *
 * @typedef {object} TemplateDeleteResult
 * @property {number} deletedCount
 * @property {NormalizedTemplateRecord[]} templates
 *
 * @typedef {object} TemplateRepository
 * @property {() => NormalizedTemplateRecord[]} getAll
 * @property {(id: EntityId) => NormalizedTemplateRecord|undefined} getById
 * @property {(payload: Partial<RawTemplateRecord>) => NormalizedTemplateRecord} add
 * @property {(payload: Partial<RawTemplateRecord>) => NormalizedTemplateRecord|null} update
 * @property {(id: EntityId) => TemplateDeleteResult} deleteById
 * @property {(templates: Array<Partial<RawTemplateRecord>|NormalizedTemplateRecord>) => NormalizedTemplateRecord[]} replaceAll
 * @property {NormalizeTemplatePayload} normalize
 * @property {(id: unknown) => boolean} hasValidId
 */

/**
 * @param {unknown} id
 * @returns {boolean}
 */
function hasValidId(id) {
  const idKey = getIdKey(id);
  return Boolean(idKey && idKey !== 'undefined' && idKey !== 'null');
}

/**
 * @param {{store: RepositoryStore, normalizeTemplatePayload: NormalizeTemplatePayload}} options
 * @returns {TemplateRepository}
 */
function createTemplateRepository({ store, normalizeTemplatePayload }) {
  const writeAll = (templates) => {
    store.set('templates', templates);
  };

  const getAll = () => {
    const templates = /** @type {Array<Partial<RawTemplateRecord>>} */ (
      store.get('templates') || []
    );
    const usedIds = new Set();
    const nextIdState = { value: Date.now() };
    let shouldWriteBack = false;
    const normalizedTemplates = templates.map((template) => {
      const normalizedTemplate = normalizeTemplatePayload(template);
      if (hasNormalizedValueChanged(template, normalizedTemplate)) {
        shouldWriteBack = true;
      }

      const normalizedIdKey = getIdKey(normalizedTemplate.id);

      if (!normalizedIdKey || usedIds.has(normalizedIdKey)) {
        normalizedTemplate.id = allocateUniqueId(normalizedTemplate.id, usedIds, nextIdState);
        shouldWriteBack = true;
      } else {
        usedIds.add(normalizedIdKey);
      }

      return normalizedTemplate;
    });

    if (shouldWriteBack) {
      writeAll(normalizedTemplates);
    }

    return normalizedTemplates;
  };

  return {
    getAll,
    getById(id) {
      return getAll().find((template) => idsEqual(template.id, id));
    },
    add(payload) {
      const templates = getAll();
      const usedIds = new Set(templates.map((item) => String(item.id)));
      const nextIdState = { value: Date.now() };
      const newTemplate = normalizeTemplatePayload({
        ...payload,
        id: allocateUniqueId(payload.id ?? null, usedIds, nextIdState),
        created_at: new Date().toISOString()
      });
      templates.push(newTemplate);
      writeAll(templates);
      return newTemplate;
    },
    update(payload) {
      const templates = getAll();
      const index = templates.findIndex((template) => idsEqual(template.id, payload.id));
      if (index === -1) {
        return null;
      }

      templates[index] = normalizeTemplatePayload(payload, templates[index]);
      writeAll(templates);
      return templates[index];
    },
    deleteById(id) {
      const templates = getAll();
      const afterTemplates = templates.filter((template) => !idsEqual(template.id, id));
      if (afterTemplates.length !== templates.length) {
        writeAll(afterTemplates);
      }
      return {
        deletedCount: templates.length - afterTemplates.length,
        templates: afterTemplates
      };
    },
    replaceAll(templates) {
      const normalizedTemplates = templates.map((template) => normalizeTemplatePayload(template));
      writeAll(normalizedTemplates);
      return normalizedTemplates;
    },
    normalize: normalizeTemplatePayload,
    hasValidId
  };
}

module.exports = {
  createTemplateRepository,
  hasValidId
};
