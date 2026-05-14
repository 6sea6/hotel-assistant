function extractJsonBlock(text, marker, openingToken = '{', closingToken = '}') {
  const source = String(text || '');
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const startIndex = source.indexOf(openingToken, markerIndex + marker.length);
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openingToken) {
      depth += 1;
      continue;
    }

    if (char === closingToken) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function extractEmbeddedObject(text, marker) {
  const jsonBlock = extractJsonBlock(text, marker, '{', '}');
  return jsonBlock ? safeJsonParse(jsonBlock) : null;
}

module.exports = {
  extractEmbeddedObject,
  extractJsonBlock,
  safeJsonParse
};
