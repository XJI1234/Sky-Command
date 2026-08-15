import type { RouteClassification, RouteWarning } from "../../domain/index.js";
import type { QualificationDocument } from "./types.js";

const WPML_MISSING = "KMZ 中未找到可提交的 waylines.wpml，仅可预览。";
const ALTITUDE_MISSING = "部分航点未提供高度，将按文件缺失状态预览。";

export interface Classification {
  readonly classification: RouteClassification;
  readonly warnings: readonly RouteWarning[];
}

export function classify(document: QualificationDocument, hasMissingAltitude: boolean): Classification {
  const warnings: RouteWarning[] = [];
  const classification: RouteClassification = document.sourceKind === "waylines-wpml"
    ? "upload-candidate"
    : "preview-only";
  if (document.format === "kmz" && document.sourceKind === "kml") {
    warnings.push(Object.freeze({ code: "WPML_MISSING" as const, message: WPML_MISSING }));
  }
  if (hasMissingAltitude) warnings.push(Object.freeze({ code: "ALTITUDE_MISSING" as const, message: ALTITUDE_MISSING }));
  return Object.freeze({ classification, warnings: Object.freeze(warnings) });
}
