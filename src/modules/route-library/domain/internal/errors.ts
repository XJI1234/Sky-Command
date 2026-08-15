import type { JsonValue, RouteErrorCode, RouteLibraryError } from "./types.js";
import { isSensitiveKey } from "./sensitive.js";

const MESSAGES: Readonly<Record<RouteErrorCode, string>> = Object.freeze({
  INVALID_CONFIGURATION: "航线库配置无效。",
  INVALID_FILE_NAME: "航线文件名为空或包含不安全字符。",
  UNSUPPORTED_FORMAT: "仅支持 KML 或 KMZ 航线文件。",
  EMPTY_FILE: "航线文件没有内容。",
  FILE_TOO_LARGE: "航线文件超过大小限制。",
  FORMAT_MISMATCH: "文件扩展名与实际内容不一致。",
  INVALID_XML: "航线文档不是有效的 XML。",
  EXTERNAL_ENTITY_FORBIDDEN: "航线文档包含禁止的外部实体或 DTD。",
  CORRUPT_KMZ: "KMZ 归档结构已损坏。",
  ENCRYPTED_KMZ: "不支持加密的 KMZ 归档。",
  ARCHIVE_ENTRY_LIMIT: "KMZ 内的文件条目数量超过限制。",
  ARCHIVE_EXPANSION_LIMIT: "KMZ 解压后的总大小超过限制。",
  UNSAFE_ARCHIVE_PATH: "KMZ 包含不安全的归档路径。",
  ROUTE_DOCUMENT_MISSING: "文件中没有可用的 KML 或 WPML 航迹文档。",
  INSUFFICIENT_WAYPOINTS: "航线至少需要两个有效航点。",
  INVALID_COORDINATE: "航点坐标、高度或序号无效。",
  TOO_MANY_WAYPOINTS: "航点数量超过限制。",
  DOMAIN_INVARIANT_VIOLATION: "航线领域数据不满足内部一致性要求。",
  ROUTE_NOT_FOUND: "指定航线不存在。",
  ROUTE_NOT_UPLOADABLE: "该航线只能预览，不能提交执行。",
  MAP_INITIALIZATION_FAILED: "三维地图初始化失败。",
  BASEMAP_LOAD_FAILED: "主底图和备用底图均加载失败。",
  CITY_MODEL_LOAD_FAILED: "杭州三维模型加载失败。"
});

const NON_RECOVERABLE: ReadonlySet<RouteErrorCode> = new Set([
  "INVALID_CONFIGURATION",
  "DOMAIN_INVARIANT_VIOLATION"
]);

const REDACTED = "[已移除不安全值]";
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const COMPLETE_XML = /^\s*<[^>]+>[\s\S]*<\/[^>]+>\s*$/;

interface CloneState {
  readonly active: Set<object>;
  sanitized: boolean;
}

function freezeJson(value: JsonValue): JsonValue {
  if (value !== null && typeof value === "object") {
    for (const child of Array.isArray(value) ? value : Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function safeString(value: string): string | undefined {
  return ABSOLUTE_PATH.test(value) || COMPLETE_XML.test(value) ? undefined : value;
}

function cloneJson(value: unknown, state: CloneState, key?: string): JsonValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    if ((key !== undefined && isSensitiveKey(key)) || safeString(value) === undefined) return undefined;
    return value;
  }
  if (typeof value !== "object") return undefined;

  if (state.active.has(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return undefined;

  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const cloned = cloneJson(item, state);
        if (cloned !== undefined) return cloned;
        state.sanitized = true;
        return REDACTED;
      });
    }

    const output: Record<string, JsonValue> = {};
    for (const property of Object.keys(value)) {
      let child: unknown;
      try {
        child = (value as Record<string, unknown>)[property];
      } catch {
        state.sanitized = true;
        continue;
      }
      const cloned = cloneJson(child, state, property);
      if (cloned === undefined) {
        state.sanitized = true;
      } else {
        output[property] = cloned;
      }
    }
    return output;
  } finally {
    state.active.delete(value);
  }
}

export function cloneStrictJson(value: unknown): JsonValue | undefined {
  const state: CloneState = { active: new Set(), sanitized: false };
  try {
    const cloned = cloneJson(value, state);
    return cloned === undefined || state.sanitized ? undefined : freezeJson(cloned);
  } catch {
    return undefined;
  }
}

function sanitizeDetails(details: unknown): JsonValue {
  const state: CloneState = { active: new Set(), sanitized: false };
  try {
    const cloned = cloneJson(details, state);
    if (cloned === undefined) return Object.freeze({ sanitized: true });
    if (state.sanitized && !Array.isArray(cloned) && cloned !== null && typeof cloned === "object") {
      (cloned as Record<string, JsonValue>).sanitized = true;
    }
    return freezeJson(cloned);
  } catch {
    return Object.freeze({ sanitized: true });
  }
}

export function createError(code: RouteErrorCode, details?: unknown): RouteLibraryError {
  const base = {
    code,
    message: MESSAGES[code],
    recoverable: !NON_RECOVERABLE.has(code)
  };
  return details === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, details: sanitizeDetails(details) });
}
