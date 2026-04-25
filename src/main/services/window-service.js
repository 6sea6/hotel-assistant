function getWindowManager() {
  return require('../window-manager');
}

function createWindowService() {
  return {
    applyThemeAppearance(theme) {
      return getWindowManager().applyThemeAppearance(theme);
    },
    applyWindowIcon(iconPath = '') {
      return getWindowManager().applyWindowIcon(iconPath);
    },
    createWindow() {
      return getWindowManager().createWindow();
    },
    getIconState(iconPath = '') {
      return getWindowManager().getIconState(iconPath);
    },
    getMainWindow() {
      return getWindowManager().getMainWindow();
    },
    handleActivate() {
      return getWindowManager().handleActivate();
    }
  };
}

module.exports = {
  createWindowService
};
