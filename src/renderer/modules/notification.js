/**
 * 通知系统 —— 右上角弹出消息提示。
 */

const NOTIFICATION_META = Object.freeze({
  info: { role: 'status', live: 'polite', icon: 'i' },
  success: { role: 'status', live: 'polite', icon: '✓' },
  warning: { role: 'alert', live: 'assertive', icon: '!' },
  error: { role: 'alert', live: 'assertive', icon: '!' }
});

function normalizeNotificationType(type) {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_META, type) ? type : 'info';
}

function getWindowTimer() {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    return window.setTimeout.bind(window);
  }
  return setTimeout;
}

/**
 * @param {HTMLElement|null|undefined} notification
 * @returns {void}
 */
export function dismissNotification(notification) {
  if (!notification || notification.dataset.dismissed === 'true') return;
  notification.dataset.dismissed = 'true';
  notification.classList.add('notification-leave');
  getWindowTimer()(() => notification.remove(), 220);
}

/**
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} [type]
 * @param {{persistent?: boolean, duration?: number}} [options]
 * @returns {HTMLElement}
 */
export function showNotification(message, type = 'info', options = {}) {
  const normalizedType = normalizeNotificationType(type);
  const meta = NOTIFICATION_META[normalizedType];
  const notification = document.createElement('div');
  notification.className = `notification notification-${normalizedType}`;
  notification.setAttribute('role', meta.role);
  notification.setAttribute('aria-live', meta.live);

  const icon = document.createElement('span');
  icon.className = 'notification-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = meta.icon;

  const messageText = document.createElement('span');
  messageText.className = 'notification-message';
  messageText.textContent = String(message || '');

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'notification-close';
  closeButton.setAttribute('aria-label', '关闭通知');
  closeButton.textContent = '×';
  if (typeof closeButton.addEventListener === 'function') {
    closeButton.addEventListener('click', () => dismissNotification(notification));
  }

  notification.appendChild(icon);
  notification.appendChild(messageText);
  notification.appendChild(closeButton);
  document.body.appendChild(notification);

  const duration = Math.max(2600, Math.min(5200, String(message || '').length * 45));

  if (!options.persistent) {
    const configuredDuration = Number(options.duration);
    const autoCloseDuration = Number.isFinite(configuredDuration) ? configuredDuration : duration;
    if (autoCloseDuration > 0) {
      getWindowTimer()(() => dismissNotification(notification), autoCloseDuration);
    }
  }
  return notification;
}
