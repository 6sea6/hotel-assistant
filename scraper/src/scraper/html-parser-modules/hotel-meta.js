const cheerio = require('cheerio');
const { normalizeText, pickFirst, toNumber, extractFirstMatch } = require('../../utils');
const { extractEmbeddedObject } = require('./embedded-json');

function extractHotelMetaFromHtml(html, url) {
  const $ = cheerio.load(html);
  const headingText = normalizeText($('h1').first().text());
  const headingLabel = normalizeText($('h1').first().attr('aria-label'));
  const titleTag = normalizeText($('title').text());
  const bodyText = normalizeText($('body').text());
  const description = $('meta[name="description"]').attr('content') || '';
  const keywords = $('meta[name="keywords"]').attr('content') || '';
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';

  const normalizedTitle = normalizeText(titleTag)
    .replace(/^携程酒店[-:：]?/, '')
    .replace(/预订价格.*$/, '')
    .replace(/预订[-|_].*$/, '')
    .replace(/【携程酒店】.*$/, '')
    .trim();
  const seoName = pickFirst(
    extractFirstMatch(description, /^([^,，。]+?(?:酒店|宾馆|客栈|公寓|旅舍|Hotel))/),
    extractFirstMatch(keywords, /^([^,，。]+?(?:酒店|宾馆|客栈|公寓|旅舍|Hotel))/),
    extractFirstMatch(ogTitle, /^([^,，。]+?(?:酒店|宾馆|客栈|公寓|旅舍|Hotel))/)
  );
  const jsonName = pickFirst(
    extractFirstMatch(html, /"nameInfo":\{"name":"([^"]+?)"/),
    extractFirstMatch(html, /"hotelDescriptionInfo":\{"hotelDescTitle":"[^\"]+","name":"([^"]+?)"/),
    extractFirstMatch(
      html,
      /"seoFooterModule":\{"description":\[\{"text":"携程网为您推荐"\},\{"text":"([^"]+?)"/
    )
  );
  const headingName = pickFirst(headingLabel, headingText);
  const title = pickFirst(headingName, normalizedTitle, jsonName, seoName, titleTag);
  const mergedText = normalizeText([title, description, bodyText].join(' '));

  const hotelName = pickFirst(
    headingName,
    jsonName,
    normalizedTitle,
    extractFirstMatch(mergedText, /#\s*([^#]+?)\s+显示地图/),
    extractFirstMatch(
      mergedText,
      /([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{3,80}(?:酒店|宾馆|客栈|公寓|旅舍|Hotel))/
    ),
    seoName,
    title.replace(/[-|_].*$/, '').trim()
  );

  const address = pickFirst(
    extractFirstMatch(description, /酒店地址：([^；。]+)[；。]/),
    extractFirstMatch(mergedText, /酒店地址[:：]\s*([^；。]+)[；。]/),
    extractFirstMatch(mergedText, /地址[:：]\s*([^；。]+)[；。]/),
    extractFirstMatch(mergedText, /\|\s*([^|]+?(?:号|路|街|弄|支路))\s*!\[Image/i)
  );

  const score = extractHotelScoreFromHtml(html, mergedText, description);

  return {
    hotelName: normalizeText(hotelName).replace(/\(/g, '（').replace(/\)/g, '）'),
    address,
    score,
    geoInfo: extractGeoInfoFromHtml(html),
    mergedText,
    sourceUrl: url
  };
}

function extractHotelScoreFromHtml(html, mergedText = '', description = '') {
  const source = String(html || '');
  const normalizedText = normalizeText(mergedText || source);
  const $ = cheerio.load(source);

  const selectorScore = pickFirst(
    toNumber(
      normalizeText($('[class*="reviewScores_reviewOverallScores-currentScore"]').first().text())
    ),
    toNumber(normalizeText($('[class*="reviewTop_reviewTop-score"]').first().text())),
    toNumber(normalizeText($('[aria-label*="out of 10"]').first().attr('aria-label'))),
    toNumber(
      normalizeText(
        $('[aria-label*="Rated"]').closest('div').find('[aria-hidden="true"]').first().text()
      )
    )
  );

  return pickFirst(
    selectorScore,
    toNumber(
      extractFirstMatch(
        source,
        /reviewScores_reviewOverallScores-currentScore[^>]*>\s*([0-9]\.[0-9])\s*</i
      )
    ),
    toNumber(
      extractFirstMatch(source, /reviewTop_reviewTop-score(?:-ctrip)?[^>]*>\s*([0-9]\.[0-9])\s*</i)
    ),
    toNumber(extractFirstMatch(source, /aria-label="([0-9]\.[0-9]) out of 10"/i)),
    toNumber(
      extractFirstMatch(source, /"hotelComment"\s*:\s*\{.*?"score"\s*:\s*"([0-9]\.[0-9])"/i)
    ),
    toNumber(extractFirstMatch(source, /"ratingAll"\s*:\s*"([0-9]\.[0-9])"/i)),
    toNumber(
      extractFirstMatch(
        source,
        /"commentStaticInfo"\s*:\s*\{.*?"ratingAll"\s*:\s*"([0-9]\.[0-9])"/i
      )
    ),
    toNumber(
      extractFirstMatch(source, /"commentRating"\s*:\s*\{.*?"ratingAll"\s*:\s*"([0-9]\.[0-9])"/i)
    ),
    toNumber(extractFirstMatch(source, /"score"\s*:\s*"([0-9]\.[0-9])"\s*,\s*"scoreDescription"/i)),
    toNumber(
      extractFirstMatch(normalizedText, /([0-9]\.[0-9])\s*(?:超棒|很好|不错|棒|分|点评|条评论)/)
    ),
    toNumber(extractFirstMatch(description, /([0-9]\.[0-9])/))
  );
}

function parseDistanceMeters(text) {
  const normalized = normalizeText(text);
  const value = toNumber(normalized);
  if (value === null) {
    return null;
  }
  if (/公里|千米|km/i.test(normalized)) {
    return Math.round(value * 1000);
  }
  if (/米|m/i.test(normalized)) {
    return Math.round(value);
  }
  return null;
}

function buildNearestSubwayCandidate(name, distanceMeters) {
  const normalizedName = normalizeText(name).replace(/^地铁[:：]\s*/, '');
  const parsedDistanceMeters = toNumber(distanceMeters);
  if (!normalizedName || parsedDistanceMeters === null || parsedDistanceMeters <= 0) {
    return null;
  }

  const roundedDistanceMeters = Math.round(parsedDistanceMeters);
  return {
    name: normalizedName,
    distanceMeters: roundedDistanceMeters,
    distanceKm: Number((roundedDistanceMeters / 1000).toFixed(1)),
    source: 'ctrip-page'
  };
}

function buildNearestSubwayFromPlaceInfo(placeInfo) {
  if (!placeInfo || typeof placeInfo !== 'object') {
    return null;
  }

  const wholePoiCandidates = (
    Array.isArray(placeInfo.wholePoiInfoList) ? placeInfo.wholePoiInfoList : []
  )
    .filter((item) => normalizeText(item && item.type) === 'metro')
    .map((item) =>
      buildNearestSubwayCandidate(
        (item && (item.poiName || item.desc)) || '',
        pickFirst(
          toNumber(item && item.walkDriveDistance),
          parseDistanceMeters(item && item.distance)
        )
      )
    )
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  if (wholePoiCandidates.length > 0) {
    return wholePoiCandidates[0];
  }

  const placeListCandidates = (Array.isArray(placeInfo.placeList) ? placeInfo.placeList : [])
    .filter((item) => normalizeText(item && item.type) === 'metro')
    .map((item) => {
      const desc = normalizeText(item && item.desc);
      return buildNearestSubwayCandidate(
        pickFirst(
          extractFirstMatch(desc, /^距(.+?地铁站)/),
          extractFirstMatch(desc, /^地铁[:：]\s*(.+?地铁站)/),
          normalizeText(item && item.poiName),
          normalizeText(item && item.desc)
        ),
        pickFirst(parseDistanceMeters(item && item.distance), parseDistanceMeters(desc))
      );
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  return placeListCandidates[0] || null;
}

function extractNearestSubwayFromEncodedTraffic(source) {
  const candidates = [
    ...String(source || '').matchAll(
      /positionShowText(?:&quot;|"):\s*(?:&quot;|")地铁[:：]\s*([^"&<]+?地铁站)(?:&quot;|")[\s\S]{0,160}?walkDriveDistance(?:&quot;|"):\s*(?:&quot;|")([0-9.]+)/g
    )
  ]
    .map((match) => buildNearestSubwayCandidate(match[1], match[2]))
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  return candidates[0] || null;
}

function extractNearestSubwayFromVisibleTraffic(source) {
  const candidates = [
    ...String(source || '').matchAll(
      /地铁[:：]\s*([^<（()]+?地铁站)[\s\S]{0,120}?（([0-9.]+)(公里|千米|米)）/g
    )
  ]
    .map((match) => buildNearestSubwayCandidate(match[1], `${match[2]}${match[3]}`))
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  return candidates[0] || null;
}

function extractGeoInfoFromHtml(html) {
  const source = String(html || '');
  const positionInfo =
    extractEmbeddedObject(source, '"hotelPositionInfo":') ||
    extractEmbeddedObject(source, '\\"hotelPositionInfo\\":');
  const normalized = normalizeText(source);
  const address = pickFirst(
    positionInfo && positionInfo.address,
    extractFirstMatch(normalized, /"hotelPositionInfo":\{.*?"address":"([^"]+)"/),
    extractFirstMatch(normalized, /\\"hotelPositionInfo\\":\{.*?\\"address\\":\\"([^"]+)\\"/)
  );
  const lng = pickFirst(
    positionInfo && positionInfo.lng,
    extractFirstMatch(normalized, /"hotelPositionInfo":\{.*?"lng":"([^"]+)"/),
    extractFirstMatch(normalized, /\\"hotelPositionInfo\\":\{.*?\\"lng\\":\\"([^"]+)\\"/)
  );
  const lat = pickFirst(
    positionInfo && positionInfo.lat,
    extractFirstMatch(normalized, /"hotelPositionInfo":\{.*?"lat":"([^"]+)"/),
    extractFirstMatch(normalized, /\\"hotelPositionInfo\\":\{.*?\\"lat\\":\\"([^"]+)\\"/)
  );
  const mapType = pickFirst(
    positionInfo && positionInfo.mapType,
    extractFirstMatch(normalized, /"hotelPositionInfo":\{.*?"mapType":"([^"]+)"/),
    extractFirstMatch(normalized, /\\"hotelPositionInfo\\":\{.*?\\"mapType\\":\\"([^"]+)\\"/)
  );
  const nearestSubway =
    buildNearestSubwayFromPlaceInfo(positionInfo && positionInfo.placeInfo) ||
    extractNearestSubwayFromEncodedTraffic(source) ||
    extractNearestSubwayFromVisibleTraffic(source);

  if (!address && !lng && !lat) {
    return null;
  }

  return {
    address,
    lng,
    lat,
    mapType,
    location: lng && lat ? `${lng},${lat}` : '',
    nearestSubway
  };
}

module.exports = {
  extractGeoInfoFromHtml,
  extractHotelMetaFromHtml,
  extractHotelScoreFromHtml
};
