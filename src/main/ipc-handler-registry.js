const HANDLER_REGISTRATIONS = [
  {
    id: 'hotel',
    modulePath: './ipc-handlers/hotel-handlers'
  },
  {
    id: 'template',
    modulePath: './ipc-handlers/template-handlers'
  },
  {
    id: 'settings',
    modulePath: './ipc-handlers/settings-handlers'
  },
  {
    id: 'data',
    modulePath: './ipc-handlers/data-handlers'
  },
  {
    id: 'prompt',
    modulePath: './ipc-handlers/prompt-handlers'
  },
  {
    id: 'other',
    modulePath: './ipc-handlers/other-handlers'
  }
];

function getHandlerRegistrations(context) {
  return HANDLER_REGISTRATIONS.map((registration) => ({
    id: registration.id,
    register: (handlerContext = context) => require(registration.modulePath)(handlerContext),
    context
  }));
}

module.exports = {
  HANDLER_REGISTRATIONS,
  getHandlerRegistrations
};
