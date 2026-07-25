/**
 * Escape HTML entities to prevent XSS when using innerHTML with external data.
 * Usage: element.innerHTML = '<b>' + escapeHtml(userName) + '</b>';
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
