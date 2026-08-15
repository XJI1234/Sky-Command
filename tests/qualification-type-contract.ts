import { RouteQualification, type RouteQualificationLimits } from "../src/modules/route-library/qualification/index.js";
import type { ParsedRouteDocument } from "../src/modules/route-library/importer/index.js";
import type { DomainResult, QualifiedRoute } from "../src/modules/route-library/domain/index.js";

declare const document: ParsedRouteDocument;
const limits: RouteQualificationLimits = { maxWaypoints: 10 };
const result: DomainResult<QualifiedRoute> = RouteQualification.qualify(document, limits);

// @ts-expect-error Qualification limits must not accept arbitrary fields as the public shape.
const badLimits: RouteQualificationLimits = { maxWaypoints: 10, maxFileBytes: 1 };

void result;
void badLimits;
