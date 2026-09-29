const path = require('path');
const { appendHotelsToStore, getCompareAppStorePath } = require('../compare-app-bridge');
const { removeHotelGroupsFromStore } = require('../compare-app/hotel-merge');
const { buildRunSummary, writeLatestRunFile } = require('./run-summary');
const { normalizeText, readJsonFile } = require('../utils');

function applyReviewedOutput(outputPath, latestRunPath, startedAt, options = {}) {
  const resolvedOutputPath = path.resolve(outputPath);
  const outputPayload = readJsonFile(resolvedOutputPath, null);

  if (!outputPayload || typeof outputPayload !== 'object') {
    throw new Error(`未找到可回写的输出文件：${resolvedOutputPath}`);
  }

  const reviewedHotels = Array.isArray(outputPayload.hotels)
    ? outputPayload.hotels.filter(Boolean)
    : [];
  const postFilter = outputPayload.post_filter || outputPayload.postFilter || {};
  const shouldDeleteFilteredGroup =
    Boolean(options.deleteFilteredGroup) &&
    reviewedHotels.length === 0 &&
    Number(postFilter.removedCount || 0) > 0;

  if (reviewedHotels.length === 0 && !shouldDeleteFilteredGroup) {
    throw new Error(`输出文件中没有可回写的 hotels 数组：${resolvedOutputPath}`);
  }

  const filteredReference = outputPayload.filtered_hotel_reference || {};
  if (
    shouldDeleteFilteredGroup &&
    !normalizeText(filteredReference.website) &&
    !normalizeText(filteredReference.name)
  ) {
    throw new Error(`输出文件缺少可安全删除的酒店标识：${resolvedOutputPath}`);
  }
  const writeResult = shouldDeleteFilteredGroup
    ? removeHotelGroupsFromStore(filteredReference)
    : appendHotelsToStore(reviewedHotels, {
        replaceExistingGroup: true,
        overwriteExistingGroup:
          Boolean(options.overwriteExistingGroup) || Number(postFilter.removedCount || 0) > 0
      });
  const finishedAt = new Date().toISOString();
  const hotelName =
    normalizeText(outputPayload.hotel && outputPayload.hotel.name) ||
    normalizeText(filteredReference.name) ||
    normalizeText(reviewedHotels[0] && reviewedHotels[0].name) ||
    '';
  const result = {
    success: true,
    startedAt,
    finishedAt,
    outputPath: resolvedOutputPath,
    compareAppStorePath: getCompareAppStorePath(),
    hotelName,
    eligibleCount: reviewedHotels.length,
    deletedFilteredGroup: shouldDeleteFilteredGroup,
    writeResult
  };

  writeLatestRunFile(
    latestRunPath,
    buildRunSummary({
      ...result,
      eligibleHotels: reviewedHotels
    })
  );

  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  applyReviewedOutput
};
