const {
  APP_CONFIG,
  HOTEL_EDITABLE_FIELDS,
  HOTEL_SYSTEM_FIELDS,
  TEMPLATE_FIELDS,
  TEMPLATE_INFO_FIELDS
} = require('../config');

const getVersionTag = () => `v${APP_CONFIG.VERSION}`;

const toFieldList = (fields) => fields.map((field) => `- ${field.key}: ${field.description}`).join('\n');

const toFieldKeyList = (fields) => fields.map((field) => `- ${field.key}`).join('\n');

const toFieldSchemaSummary = (fields) => fields.map((field) => `- ${field.key} (${field.type})${field.required ? '，必填' : ''}: ${field.description}`).join('\n');

module.exports = {
  APP_CONFIG,
  HOTEL_EDITABLE_FIELDS,
  HOTEL_SYSTEM_FIELDS,
  TEMPLATE_FIELDS,
  TEMPLATE_INFO_FIELDS,
  getVersionTag,
  toFieldKeyList,
  toFieldList,
  toFieldSchemaSummary
};
