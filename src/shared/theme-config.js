(function initThemeConfig(root) {
  const THEME_ALIAS_MAP = Object.freeze({
    light: 'cloud-white',
    'changing-mode': 'colorful-mode'
  });

  const SUPPORTED_THEMES = Object.freeze([
    'totoro-blue',
    'sweet-lime',
    'grass-green',
    'pineapple-yellow',
    'oak-brown',
    'cloud-white',
    'autumn-gold',
    'diehard-pink',
    'grape-purple',
    'colorful-mode'
  ]);

  const THEME_WINDOW_COLORS = Object.freeze({
    'totoro-blue': '#EEF4F9',
    'sweet-lime': '#EEF7F3',
    'grass-green': '#F2F7EB',
    'pineapple-yellow': '#FCF5DE',
    'oak-brown': '#F8F0E9',
    'cloud-white': '#FFFFFF',
    'autumn-gold': '#FFF8E7',
    'diehard-pink': '#FEF2F7',
    'grape-purple': '#F4F0FF',
    'colorful-mode': '#FFF7FB'
  });

  const THEME_TITLEBAR_COLORS = Object.freeze({
    'totoro-blue': '#6B8FB5',
    'sweet-lime': '#4E8C80',
    'grass-green': '#6A934A',
    'pineapple-yellow': '#C39A23',
    'oak-brown': '#8A6344',
    'cloud-white': '#FFFFFF',
    'autumn-gold': '#DDB457',
    'diehard-pink': '#E28EB0',
    'grape-purple': '#8A73D1',
    'colorful-mode': '#8A78F2'
  });

  const THEME_TITLEBAR_SYMBOL_COLORS = Object.freeze({
    'totoro-blue': '#FFFFFF',
    'sweet-lime': '#FFFFFF',
    'grass-green': '#FFFFFF',
    'pineapple-yellow': '#FFFBEF',
    'oak-brown': '#FFFFFF',
    'cloud-white': '#5A5F66',
    'autumn-gold': '#FFFCEF',
    'diehard-pink': '#FFFDFE',
    'grape-purple': '#FFFEFF',
    'colorful-mode': '#FFFDFE'
  });

  const SUPPORTED_THEME_SET = new Set(SUPPORTED_THEMES);

  function isSupportedTheme(theme) {
    return SUPPORTED_THEME_SET.has(theme);
  }

  function normalizeThemeKey(theme = '', fallbackTheme = 'totoro-blue') {
    const themeKey = String(theme || '');
    const normalizedTheme = THEME_ALIAS_MAP[themeKey] || themeKey;
    return isSupportedTheme(normalizedTheme) ? normalizedTheme : fallbackTheme;
  }

  function getThemeWindowBackground(theme = '') {
    return THEME_WINDOW_COLORS[normalizeThemeKey(theme)] || '';
  }

  function getThemeTitleBarColor(theme = '') {
    const normalizedTheme = normalizeThemeKey(theme);
    return THEME_TITLEBAR_COLORS[normalizedTheme] || getThemeWindowBackground(normalizedTheme);
  }

  function getThemeTitleBarSymbolColor(theme = '') {
    return THEME_TITLEBAR_SYMBOL_COLORS[normalizeThemeKey(theme)] || '#FFFFFF';
  }

  const themeConfig = Object.freeze({
    THEME_ALIAS_MAP,
    SUPPORTED_THEMES,
    THEME_WINDOW_COLORS,
    THEME_TITLEBAR_COLORS,
    THEME_TITLEBAR_SYMBOL_COLORS,
    getThemeTitleBarColor,
    getThemeTitleBarSymbolColor,
    getThemeWindowBackground,
    isSupportedTheme,
    normalizeThemeKey
  });

  if (typeof module === 'object' && module.exports) {
    module.exports = themeConfig;
    return;
  }

  const target = /** @type {Record<string, unknown>} */ (root);
  target.HotelComparisonThemeConfig = themeConfig;
})(typeof globalThis !== 'undefined' ? globalThis : this);
