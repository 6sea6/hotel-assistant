function createTaskEmitter(onEvent) {
  return (type, message, details = {}) => {
    if (typeof onEvent !== 'function') {
      return;
    }

    onEvent({
      type,
      message,
      details,
      at: new Date().toISOString()
    });
  };
}

function createScrapeEventForwarder(emit) {
  const notifiedLoginPrompts = new Set();
  return (type, message, details = {}) => {
    if (type === 'edge:login-required') {
      const key = `${type}:${details.reason || message || ''}`;
      if (notifiedLoginPrompts.has(key)) {
        return;
      }
      notifiedLoginPrompts.add(key);
    }
    emit(type, message, details);
  };
}

module.exports = {
  createScrapeEventForwarder,
  createTaskEmitter
};
