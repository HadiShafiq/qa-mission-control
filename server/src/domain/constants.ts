// Allowed values for string status columns. Validated at the API boundary so the
// schema stays portable between SQLite and PostgreSQL.

export const ANALYSIS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'ANALYSED', 'APPROVED'] as const;
export const PROGRESS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;
export const ENVIRONMENT_TYPES = ['SIT', 'UAT', 'LOCAL', 'CUSTOM'] as const;
export const EXECUTION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'BLOCKED', 'NOT_APPLICABLE'] as const;
export const OPEN_DEFECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RETEST', 'REOPENED'] as const;

// Requirements (Phase 2)
export const REQUIREMENT_TYPES = ['FUNCTIONAL', 'NON_FUNCTIONAL'] as const;
export const REQUIREMENT_CLASSIFICATIONS = ['EXPLICIT', 'INFERRED', 'ASSUMPTION', 'CLARIFICATION_REQUIRED'] as const;
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CLARIFICATION_REQUIRED'] as const;

// Agent tasks
export const AGENT_TASK_STATUSES = ['QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const ACTIVE_TASK_STATUSES = ['QUEUED', 'RUNNING'] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
