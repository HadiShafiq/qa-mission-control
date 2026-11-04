-- CreateTable
CREATE TABLE "ScenarioWorkbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crId" TEXT NOT NULL,
    "agentTaskId" TEXT,
    "version" INTEGER NOT NULL,
    "model" TEXT,
    "documents" TEXT NOT NULL,
    "dimensions" TEXT NOT NULL,
    "wip" TEXT NOT NULL,
    "enhancement" TEXT NOT NULL,
    "decisionTables" TEXT NOT NULL,
    "requirementCoverage" TEXT NOT NULL,
    "wipCoverage" TEXT NOT NULL,
    "enhancementCoverage" TEXT NOT NULL,
    "clarifications" TEXT NOT NULL,
    "selfReview" TEXT NOT NULL,
    "checks" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScenarioWorkbook_crId_fkey" FOREIGN KEY ("crId") REFERENCES "ChangeRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScenarioRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScenarioRevision_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "TestScenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TestScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crId" TEXT NOT NULL,
    "workbookId" TEXT,
    "scenarioCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "testType" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "userRole" TEXT,
    "automationFeasibility" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "requirementRef" TEXT,
    "module" TEXT,
    "functionScreen" TEXT,
    "enhancementState" TEXT,
    "transactionState" TEXT,
    "workflowStatus" TEXT,
    "businessCondition" TEXT,
    "existingValue" TEXT,
    "actionChange" TEXT,
    "confirmation" TEXT,
    "testData" TEXT,
    "expectedResult" TEXT,
    "regression" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "sourceReference" TEXT,
    "sourceQuote" TEXT,
    "sourceVerified" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'AI',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reviewComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestScenario_crId_fkey" FOREIGN KEY ("crId") REFERENCES "ChangeRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestScenario_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "ScenarioWorkbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TestScenario" ("automationFeasibility", "crId", "createdAt", "description", "id", "priority", "reviewStatus", "scenarioCode", "testType", "title", "updatedAt", "userRole") SELECT "automationFeasibility", "crId", "createdAt", "description", "id", "priority", "reviewStatus", "scenarioCode", "testType", "title", "updatedAt", "userRole" FROM "TestScenario";
DROP TABLE "TestScenario";
ALTER TABLE "new_TestScenario" RENAME TO "TestScenario";
CREATE INDEX "TestScenario_crId_reviewStatus_idx" ON "TestScenario"("crId", "reviewStatus");
CREATE UNIQUE INDEX "TestScenario_workbookId_scenarioCode_key" ON "TestScenario"("workbookId", "scenarioCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioWorkbook_crId_version_key" ON "ScenarioWorkbook"("crId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioRevision_scenarioId_revision_key" ON "ScenarioRevision"("scenarioId", "revision");
