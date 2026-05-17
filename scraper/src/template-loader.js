const fs = require('fs');
const path = require('path');
const { buildDesktopUrl, extractCtripUrlsFromInput } = require('./ctrip-url');
const { differenceInDays, normalizeText, readJsonFile, toNumber } = require('./utils');

function normalizeTemplateRoomCount(value) {
  const parsed = toNumber(value);
  if (parsed === null) {
    return null;
  }

  return Math.max(1, parsed);
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  return fallback;
}

function buildCtripUrlWithStayDates(rawUrl, checkInDate, checkOutDate, roomCount) {
  return buildDesktopUrl(rawUrl, {
    checkIn: checkInDate,
    checkOut: checkOutDate,
    adult: roomCount,
    children: roomCount ? 0 : undefined,
    infants: roomCount ? 0 : undefined
  });
}

function loadTemplate(templatePath) {
  if (!templatePath) {
    return {};
  }

  const absolutePath = path.resolve(templatePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`模板文件不存在: ${absolutePath}`);
  }

  const template = readJsonFile(absolutePath, {});
  return normalizeTemplate(template);
}

function normalizeTemplate(raw = {}) {
  const inputUrls = extractCtripUrlsFromInput(raw);
  const normalized = {
    ctrip_url: normalizeText(raw.ctrip_url || raw.url || inputUrls[0] || ''),
    destination: normalizeText(raw.destination || ''),
    check_in_date: normalizeText(raw.check_in_date || raw.checkIn || ''),
    check_out_date: normalizeText(raw.check_out_date || raw.checkOut || ''),
    room_type: normalizeText(raw.room_type || raw.roomType || ''),
    room_count: normalizeTemplateRoomCount(raw.room_count || raw.roomCount),
    template_id: raw.template_id ?? raw.templateId ?? null,
    template_name: normalizeText(raw.template_name || raw.templateName || ''),
    notes: normalizeText(raw.notes || ''),
    edge_user_data_dir: normalizeText(raw.edge_user_data_dir || raw.edgeUserDataDir || ''),
    edge_profile_directory: normalizeText(
      raw.edge_profile_directory || raw.edgeProfileDirectory || raw.edgeProfile || ''
    ),
    edge_debugger_url: normalizeText(raw.edge_debugger_url || raw.edgeDebuggerUrl || ''),
    edge_debugging_port: toNumber(raw.edge_debugging_port || raw.edgeDebuggingPort),
    edge_headless: toBoolean(raw.edge_headless ?? raw.edgeHeadless, true)
  };

  normalized.days = differenceInDays(normalized.check_in_date, normalized.check_out_date);
  return normalized;
}

function mergeTemplateWithArgs(template, args) {
  const inputUrls = extractCtripUrlsFromInput(args);
  return normalizeTemplate({
    ...template,
    ctrip_url:
      args.url ||
      args.ctripUrl ||
      args.ctrip_url ||
      args['ctrip-url'] ||
      inputUrls[0] ||
      template.ctrip_url,
    destination: args.destination || template.destination,
    check_in_date: args.checkIn || args.check_in_date || template.check_in_date,
    check_out_date: args.checkOut || args.check_out_date || template.check_out_date,
    room_type: args.roomType || args.room_type || template.room_type,
    room_count: args.roomCount || args.room_count || template.room_count,
    template_id: args.templateId || args.template_id || template.template_id,
    template_name: args.templateName || args.template_name || template.template_name,
    notes: args.notes || template.notes,
    edge_user_data_dir:
      args.edgeUserDataDir ||
      args['edge-user-data-dir'] ||
      args.edge_user_data_dir ||
      template.edge_user_data_dir,
    edge_profile_directory:
      args.edgeProfileDirectory ||
      args['edge-profile-directory'] ||
      args.edge_profile_directory ||
      template.edge_profile_directory,
    edge_debugger_url:
      args.edgeDebuggerUrl ||
      args['edge-debugger-url'] ||
      args.edge_debugger_url ||
      template.edge_debugger_url,
    edge_debugging_port:
      args.edgeDebuggingPort ||
      args['edge-debugging-port'] ||
      args.edge_debugging_port ||
      template.edge_debugging_port,
    edge_headless:
      args.edgeHeadless ?? args['edge-headless'] ?? args.edge_headless ?? template.edge_headless
  });
}

function applyMatchedTemplate(template, matchedTemplate) {
  const normalized = normalizeTemplate({
    ...template,
    template_name: matchedTemplate
      ? normalizeText(matchedTemplate.name || template.template_name)
      : template.template_name,
    destination: matchedTemplate ? matchedTemplate.destination : template.destination,
    check_in_date: matchedTemplate ? matchedTemplate.check_in_date : template.check_in_date,
    check_out_date: matchedTemplate ? matchedTemplate.check_out_date : template.check_out_date,
    room_count: matchedTemplate ? matchedTemplate.room_count : template.room_count,
    template_id: matchedTemplate ? matchedTemplate.id : template.template_id
  });

  normalized.ctrip_url = buildCtripUrlWithStayDates(
    normalized.ctrip_url,
    normalized.check_in_date,
    normalized.check_out_date,
    normalized.room_count
  );
  normalized.days = differenceInDays(normalized.check_in_date, normalized.check_out_date);
  return normalized;
}

function validateTemplate(template) {
  const missing = [];
  if (!template.ctrip_url) missing.push('ctrip_url');
  if (!template.check_in_date) missing.push('check_in_date');
  if (!template.check_out_date) missing.push('check_out_date');
  if (!template.room_count) missing.push('room_count');

  if (missing.length > 0) {
    throw new Error(`模板缺少必填字段: ${missing.join(', ')}`);
  }

  if (template.room_count > 3) {
    throw new Error(
      '当前采集仅支持 1-3 人模板；如需保留 4 人房，请使用 3 人模板并开启“3人模板时额外保留4人房”。'
    );
  }
}

module.exports = {
  applyMatchedTemplate,
  buildCtripUrlWithStayDates,
  loadTemplate,
  mergeTemplateWithArgs,
  normalizeTemplateRoomCount,
  normalizeTemplate,
  validateTemplate
};
