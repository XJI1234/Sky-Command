import type { RouteClassification, RouteWarning } from "../../domain/index.js";
import type { QualificationDocument } from "./types.js";

const WPML_MISSING = "KMZ 中未找到可提交的 waylines.wpml，仅可预览。";
const DJI_TEMPLATE_MISSING = "KMZ 缺少与 waylines.wpml 配套的 template.kml，仅可预览。";
const WAYLINE_PATH_NOT_CANONICAL = "航线文件必须位于 wpmz/waylines.wpml，才能与手机端上传检查一致，仅可预览。";
const WAYLINE_COUNT_NOT_ONE = "航线包必须恰好包含一条 WPML 航线，才能与手机端上传检查一致，仅可预览。";
const ALTITUDE_MISSING = "部分航点未提供高度，将按文件缺失状态预览。";
const PHONE_CANONICAL_WPML = "wpmz/waylines.wpml";

export interface Classification {
  readonly classification: RouteClassification;
  readonly warnings: readonly RouteWarning[];
}

export function classify(document: QualificationDocument, hasMissingAltitude: boolean): Classification {
  const warnings: RouteWarning[] = [];
  let classification: RouteClassification = "preview-only";

  if (document.format === "kmz" && document.sourceKind === "kml") {
    warnings.push(Object.freeze({ code: "WPML_MISSING" as const, message: WPML_MISSING }));
  } else if (document.format === "kmz" && document.sourceKind === "waylines-wpml") {
    if (!document.hasCompanionTemplate) {
      warnings.push(Object.freeze({ code: "DJI_TEMPLATE_MISSING" as const, message: DJI_TEMPLATE_MISSING }));
    } else if (document.sourceDocument !== PHONE_CANONICAL_WPML) {
      warnings.push(Object.freeze({ code: "WAYLINE_PATH_NOT_CANONICAL" as const, message: WAYLINE_PATH_NOT_CANONICAL }));
    } else if (document.djiWaylineCount !== 1) {
      warnings.push(Object.freeze({ code: "WAYLINE_COUNT_NOT_ONE" as const, message: WAYLINE_COUNT_NOT_ONE }));
    } else {
      classification = "upload-candidate";
    }
  }

  if (hasMissingAltitude) warnings.push(Object.freeze({ code: "ALTITUDE_MISSING" as const, message: ALTITUDE_MISSING }));
  return Object.freeze({ classification, warnings: Object.freeze(warnings) });
}
