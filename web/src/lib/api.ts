// Typed API client. All requests go to /api (proxied to the backend by Vite in dev).

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the QA Mission Control server. Check that the backend is running (npm run dev).');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: { field: string; message: string }[] } })?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  upload: <T>(url: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return request<T>('POST', url, fd);
  },
};

export function qs(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

// ───────── Types mirrored from the backend ─────────

export type Project = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  crCount: number;
  environmentCount?: number;
  environments?: Environment[];
};

export type Environment = {
  id: string;
  projectId: string;
  name: string;
  type: 'SIT' | 'UAT' | 'LOCAL' | 'CUSTOM';
  baseUrl: string;
  description: string | null;
  archivedAt: string | null;
};

export type AnalysisStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'ANALYSED' | 'APPROVED';
export type ProgressStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export type ChangeRequest = {
  id: string;
  projectId: string;
  crNumber: string;
  title: string;
  description: string | null;
  version: string;
  analysisStatus: AnalysisStatus;
  automationStatus: ProgressStatus;
  evidenceStatus: ProgressStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; code: string; name: string; archivedAt: string | null };
  documentCount: number;
  requirementCount: number;
  scenarioCount: number;
};

export type SourceDocument = {
  id: string;
  crId: string;
  originalName: string;
  mimeType: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  uploadedBy: string;
  archivedAt: string | null;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  projectId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  actor: string;
  createdAt: string;
  project?: { code: string } | null;
};

export type DashboardSummary = {
  generatedAt: string;
  counts: {
    totalProjects: number;
    totalCrs: number;
    sourceDocuments: number;
    requirements: number;
    uncoveredRequirements: number;
    scenarios: number;
    approvedScenarios: number;
    testCases: number;
    passed: number;
    failed: number;
    blocked: number;
    notRun: number;
    openDefects: number;
    pendingApprovals: number;
  };
  percentages: { automationCoverage: number | null; executionProgress: number | null; evidenceCompletion: number | null };
  executionStatus: Record<string, number>;
  activeCrs: (Pick<ChangeRequest, 'id' | 'crNumber' | 'title' | 'analysisStatus' | 'updatedAt' | 'version'> & {
    project: { id: string; code: string };
    documentCount: number;
  })[];
  recentActivity: AuditEntry[];
  agentActivity: { id: string; agent: string; taskType: string; status: string; createdAt: string }[];
  ai: { configured: boolean };
};

export type Settings = {
  version: string;
  environment: string;
  database: string;
  storageDir: string;
  maxUploadMb: number;
  ai: { provider: string; configured: boolean; authSource: 'api-key' | 'ant-profile' | 'claude-code' | null; model: string; status: string; effort: string; maxInputTokens: number; maxOutputTokens: number };
};

export type UploadRules = { allowedExtensions: string[]; maxUploadBytes: number };

// ───────── Phase 2: CR analysis ─────────

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUIRED';
export type Classification = 'EXPLICIT' | 'INFERRED' | 'ASSUMPTION' | 'CLARIFICATION_REQUIRED';
export type RequirementType = 'FUNCTIONAL' | 'NON_FUNCTIONAL';
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';

export type Requirement = {
  id: string;
  crId: string;
  requirementCode: string;
  module: string | null;
  feature: string | null;
  description: string;
  requirementType: RequirementType;
  classification: Classification;
  businessRule: string | null;
  userRole: string | null;
  sourceReference: string | null;
  sourceDocumentId: string | null;
  sourceQuote: string | null;
  sourceVerified: boolean;
  rationale: string | null;
  origin: 'AI' | 'MANUAL';
  agentTaskId: string | null;
  revision: number;
  reviewComment: string | null;
  risk: Risk;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
};

export type RequirementRevision = {
  id: string;
  requirementId: string;
  revision: number;
  snapshot: Record<string, unknown>;
  changeNote: string | null;
  createdBy: string;
  createdAt: string;
};

export type TaskStatus = 'QUEUED' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type AnalysisOutput = {
  crSummary: string;
  impactedModules: string[];
  regressionImpact: string[];
  requirementCount: number;
  verifiedCount: number;
  unverifiedCount: number;
  documents: { id: string; name: string; version: number; segments: number; warnings: string[] }[];
};

export type AgentTask = {
  id: string;
  projectId: string;
  crId: string | null;
  agent: string;
  taskType: string;
  status: TaskStatus;
  progress: number;
  progressMessage: string | null;
  model: string | null;
  input: { documentIds: string[] } | null;
  output: AnalysisOutput | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type DocumentExtraction = {
  documentId: string;
  name: string;
  version: number;
  fileType: string;
  segments: { ref: string; text: string }[];
  charCount: number;
  warnings: string[];
  notes: string[];
  image: boolean;
  images: { n: number; ref: string; context: string; mediaType: string; sizeBytes: number }[];
};

/** A source reference that points at a picture inside a document (cannot be text-verified). */
export const isPictureSource = (ref: string | null) => Boolean(ref && /› Image \d+ \(in /.test(ref));

export type Artifact = {
  id: string;
  projectId: string;
  crId: string | null;
  artifactType: string;
  name: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
};
