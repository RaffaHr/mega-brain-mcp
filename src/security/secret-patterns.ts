export const SECRET_KEY_PATTERN = /(?:api[_-]?key|auth(?:orization)?|cookie|credential|pass(?:word|wd)?|private[_-]?key|secret|session[_-]?token|token)/i;

export const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;]+/gi,
  /\b(Cookie\s*:\s*)[^\r\n]+/gi,
  /\b((?:api[_-]?key|auth(?:orization)?|cookie|credential|pass(?:word|wd)?|private[_-]?key|secret|session[_-]?token|token)\s*[=:]\s*)[^\s,;]+/gi,
  /\b((?:sk|ghp|gho|github_pat|glpat|xox[baprs])[_-])[A-Za-z0-9_\-]{10,}/gi,
  /(https?:\/\/[^\s:/]+:)[^@\s/]+@/gi,
];
