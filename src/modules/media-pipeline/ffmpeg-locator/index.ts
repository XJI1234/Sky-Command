export type FfmpegSource = "configured" | "bundled" | "system";

export interface FfmpegCandidate {
  readonly source: FfmpegSource;
  readonly executablePath: string;
}

export interface FileFacts {
  readonly isExecutableFile: (path: string) => boolean;
}

export type LocateResult =
  | Readonly<{ readonly ok: true; readonly value: Readonly<FfmpegCandidate> }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "FFMPEG_NOT_FOUND" | "INSPECTION_FAILED"; readonly diagnostic: string }>;

export interface FfmpegLocatorInstance {
  readonly locate: (candidates: unknown) => LocateResult;
}

const INVALID_INPUT = "FFmpeg 候选配置无效。请检查桌面端安装配置。";
const NOT_FOUND = "未找到可用的 FFmpeg。请安装 FFmpeg 或检查桌面端配置。";
const INSPECTION_FAILED = "无法检查 FFmpeg 可执行文件。请检查桌面端权限与安装状态。";

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

function failure(code: "INVALID_INPUT" | "FFMPEG_NOT_FOUND" | "INSPECTION_FAILED", diagnostic: string): LocateResult {
  return freeze({ ok: false as const, code, diagnostic });
}

function isSource(value: unknown): value is FfmpegSource {
  return value === "configured" || value === "bundled" || value === "system";
}

function candidate(value: unknown): FfmpegCandidate | null {
  if (value == null) return null;
  const raw = value as FfmpegCandidate;
  if (!isSource(raw.source)) return null;
  if (typeof raw.executablePath !== "string" || raw.executablePath.trim().length === 0) return null;
  return freeze({ source: raw.source, executablePath: raw.executablePath });
}

function normalizeCandidates(value: unknown): readonly FfmpegCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(candidate);
  if (normalized.some((item) => item === null)) return null;
  const paths = new Set<string>();
  for (const item of normalized) {
    const path = item!.executablePath;
    if (paths.has(path)) return null;
    paths.add(path);
  }
  return normalized as readonly FfmpegCandidate[];
}

function fileFacts(value: unknown): value is FileFacts {
  if (value == null) return false;
  return typeof (value as FileFacts).isExecutableFile === "function";
}

function create(facts: FileFacts): FfmpegLocatorInstance {
  if (!fileFacts(facts)) throw new TypeError("Invalid file facts");
  return freeze({ locate: (input) => {
    const candidates = normalizeCandidates(input);
    if (candidates === null) return failure("INVALID_INPUT", INVALID_INPUT);
    try {
      for (const item of candidates) {
        if (facts.isExecutableFile(item.executablePath)) return freeze({ ok: true as const, value: item });
      }
    } catch {
      return failure("INSPECTION_FAILED", INSPECTION_FAILED);
    }
    return failure("FFMPEG_NOT_FOUND", NOT_FOUND);
  }});
}

class FfmpegLocatorApi { readonly create = create; }
export const FfmpegLocator = freeze(new FfmpegLocatorApi());
