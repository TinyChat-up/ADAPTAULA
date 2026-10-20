import type { ValidationCode } from "./file-validation";

export type ServiceError = ValidationCode | "forbidden" | "not_found" | "upload_expired" | "rate_limited" | "too_many_active" | "quota_exceeded" | "failure_budget" | "unexpected";
