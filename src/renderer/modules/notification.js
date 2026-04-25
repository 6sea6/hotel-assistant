/**
 * 通知系统 —— 右下角弹出消息提示。
 */

export function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  const duration = Math.max(2600, Math.min(5200, String(message || '').length * 45));

  window.setTimeout(() => {
    notification.classList.add('notification-leave');
    window.setTimeout(() => notification.remove(), 220);
  }, duration);
}
