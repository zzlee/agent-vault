/**
 * Sanitizes messages and content before saving to the git-tracked data layer.
 * Masks sensitive API keys, tokens, and credentials.
 */

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI & generic sk- tokens
  {
    pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED_API_KEY]',
  },
  // Anthropic API keys
  {
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED_ANTHROPIC_KEY]',
  },
  // GitHub tokens
  {
    pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  // Google API keys
  {
    pattern: /AIza[0-9A-Za-z\\-_]{35}/g,
    replacement: '[REDACTED_GOOGLE_API_KEY]',
  },
  // AWS Access Key ID
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED_AWS_KEY_ID]',
  },
  // Bearer tokens
  {
    pattern: /Bearer\s+([A-Za-z0-9\-_.~+/]{25,}=*)/gi,
    replacement: 'Bearer [REDACTED_BEARER_TOKEN]',
  },
];

export function sanitizeText(text: string): string {
  if (!text) return '';
  let sanitized = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
