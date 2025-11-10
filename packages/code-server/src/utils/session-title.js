/**
 * Generate a unique session title based on the first user message or a default.
 * @param {string} firstMessage - The first message in the session.
 * @returns {string} - The generated session title.
 */
export function generateSessionTitle(firstMessage) {
  if (!firstMessage.trim()) {
    return "New Session";
  }
  // Truncate to first 50 characters and remove newlines
  const title = firstMessage.slice(0, 50).replace(/\n/g, " ");
  return title;
}