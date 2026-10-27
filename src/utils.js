/**
 * Privacy & Logging Utilities
 * 
 * Provides masking helpers to ensure sensitive credentials (emails, phone numbers,
 * names, and tokens) are never leaked to public stdout or CI/CD logs.
 */

/**
 * Masks a sensitive string (email, phone, or name) for safe public logging.
 * 
 * @param {string} str - Raw string to mask
 * @returns {string} - Masked string safe for public logs
 */
export function maskSensitive(str) {
  if (!str || typeof str !== 'string') return '***';

  const trimmed = str.trim();
  if (trimmed.length === 0) return '***';

  // Email masking: e.g. "jane.doe@example.com" -> "ja***e@example.com"
  if (trimmed.includes('@')) {
    const [user, domain] = trimmed.split('@');
    if (!domain) return '***';
    const maskedUser = user.length <= 2 
      ? `${user[0] ?? ''}***` 
      : `${user.slice(0, 2)}***${user.slice(-1)}`;
    return `${maskedUser}@${domain}`;
  }

  // Phone numbers or identifiers: e.g. "+15551234567" -> "+15***67"
  if (trimmed.length > 4) {
    return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
  }

  // Very short strings (e.g. short names)
  return `${trimmed[0]}***`;
}
