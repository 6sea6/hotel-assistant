function prependSection(content, marker, section) {
  const normalized = String(content || '');
  if (normalized.includes(marker)) {
    return normalized;
  }
  return `${section}\n\n${normalized}`;
}

module.exports = {
  prependSection
};
