const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  "key",
  "token",
  "secret",
  "password",
  "byte",
  "bytes",
  "xml",
  "path"
]);

const COMPACT_SENSITIVE_KEY = /^(?:(?:api|map|access|auth|client|private|public|file|original)(?:key|token|secret|password|bytes?|xml|path))$/i;

export function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]/)
    .map((word) => word.toLowerCase());

  return words.some((word) => SENSITIVE_WORDS.has(word)) || COMPACT_SENSITIVE_KEY.test(key);
}
