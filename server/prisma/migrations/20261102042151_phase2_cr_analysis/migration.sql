-- AlterTable
ALTER TABLE "RequirementRevision" ADD COLUMN "changeNote" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "crId" TEXT,
    "agent" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "model" TEXT,
    "input" TEXT,
    "output" TEXT,
    "usage" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTask_crId_fkey" FOREIGN KEY ("crId") REFERENCES "ChangeRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentTask" ("agent", "createdAt", "error", "finishedAt", "id", "input", "output", "projectId", "status", "taskType") SELECT "agent", "createdAt", "error", "finishedAt", "id", "input", "output", "projectId", "status", "taskType" FROM "AgentTask";
DROP TABLE "AgentTask";
ALTER TABLE "new_AgentTask" RENAME TO "AgentTask";
CREATE INDEX "AgentTask_projectId_status_idx" ON "AgentTask"("projectId", "status");
CREATE INDEX "AgentTask_crId_createdAt_idx" ON "AgentTask"("crId", "createdAt");
CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crId" TEXT NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "module" TEXT,
    "feature" TEXT,
    "description" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL DEFAULT 'FUNCTIONAL',
    "classification" TEXT NOT NULL DEFAULT 'EXPLICIT',
    "businessRule" TEXT,
    "userRole" TEXT,
    "sourceReference" TEXT,
    "sourceDocumentId" TEXT,
    "sourceQuote" TEXT,
    "sourceVerified" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "agentTaskId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reviewComment" TEXT,
    "risk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Requirement_crId_fkey" FOREIGN KEY ("crId") REFERENCES "ChangeRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Requirement" ("businessRule", "classification", "crId", "createdAt", "description", "feature", "id", "module", "requirementCode", "requirementType", "reviewStatus", "risk", "sourceReference", "updatedAt", "userRole") SELECT "businessRule", "classification", "crId", "createdAt", "description", "feature", "id", "module", "requirementCode", "requirementType", "reviewStatus", "risk", "sourceReference", "updatedAt", "userRole" FROM "Requirement";
DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
CREATE UNIQUE INDEX "Requirement_crId_requirementCode_key" ON "Requirement"("crId", "requirementCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
