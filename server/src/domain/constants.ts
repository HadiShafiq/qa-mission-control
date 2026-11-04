// Allowed values for string status columns. Validated at the API boundary so the
// schema stays portable between SQLite and PostgreSQL.

export const ANALYSIS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'ANALYSED', 'APPROVED'] as const;
export const PROGRESS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;
export const ENVIRONMENT_TYPES = ['SIT', 'UAT', 'LOCAL', 'CUSTOM'] as const;
export const EXECUTION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'BLOCKED', 'NOT_APPLICABLE'] as const;
export const OPEN_DEFECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RETEST', 'REOPENED'] as const;

// Review of generated test scenarios
// Test Scenario Type values (the user's QA prompt, section 6)
export const SCENARIO_TYPES = [
  'Positive',
  'Negative',
  'Main Flow',
  'Alternative Flow',
  'Business Rule',
  'Validation',
  'Boundary',
  'Status / Workflow',
  'Role / Access',
  'Enhancement',
  'WIP',
  'Non-WIP',
  'Data Behaviour',
  'Integration',
  'Regression',
  'Exception / Error',
] as const;
export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CLARIFICATION_REQUIRED'] as const;

// Agent tasks
export const AGENT_TASK_STATUSES = ['QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const ACTIVE_TASK_STATUSES = ['QUEUED', 'RUNNING'] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
