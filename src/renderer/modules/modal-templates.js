/**
 * 延迟挂载低频弹窗模板，减少初始 DOM 负担。
 */

export function ensureModalTemplateMounted(modalId) {
  const existing = document.getElementById(modalId);
  if (existing) return existing;

  const template = document.querySelector(`template[data-modal-template="${modalId}"]`);
  if (!(template instanceof HTMLTemplateElement)) return null;

  const fragment = template.content.cloneNode(true);
  const firstElement =
    fragment instanceof DocumentFragment
      ? /** @type {HTMLElement|null} */ (fragment.firstElementChild)
      : null;
  const mountPoint = document.getElementById('modalTemplateMount') || document.body;
  mountPoint.appendChild(fragment);

  return document.getElementById(modalId) || firstElement;
}
