-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "minMarginPercent" REAL NOT NULL DEFAULT 20,
    "emergencyCapPercent" REAL NOT NULL DEFAULT 10,
    "emergencyPerExpenseLimit" REAL NOT NULL DEFAULT 50000,
    "approvalThresholdAmount" REAL NOT NULL DEFAULT 150000,
    "defaultBillingTemplate" JSONB,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "location" TEXT,
    "clientId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "issueTitle" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Request_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "industry" TEXT,
    "primaryContact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "storeType" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "amcStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Store_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Store_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientId" TEXT,
    "executionType" TEXT NOT NULL DEFAULT 'HYBRID',
    "status" TEXT NOT NULL DEFAULT 'LEAD',
    "poNumber" TEXT,
    "poValue" REAL,
    "baselineCost" REAL,
    "budgetFrozenAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recce" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "visitDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "conditionSummary" JSONB NOT NULL,
    "measurements" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recce_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Recce_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Recce_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecceImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recceId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecceImage_recceId_fkey" FOREIGN KEY ("recceId") REFERENCES "Recce" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitRate" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RateCard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Boq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "recceId" TEXT NOT NULL,
    "projectCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalStage" TEXT NOT NULL DEFAULT 'DRAFT',
    "internalApprovalId" TEXT,
    "subtotal" REAL NOT NULL,
    "taxAmount" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "approvedById" TEXT,
    "financeReviewComment" TEXT,
    "clientReviewComment" TEXT,
    "financeReviewedById" TEXT,
    "financeReviewedAt" DATETIME,
    "clientApprovedAt" DATETIME,
    "approvedOnBehalfById" TEXT,
    "poNumber" TEXT,
    "budgetFrozenAt" DATETIME,
    "revenueLockedAmount" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Boq_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Boq_recceId_fkey" FOREIGN KEY ("recceId") REFERENCES "Recce" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Boq_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Boq_financeReviewedById_fkey" FOREIGN KEY ("financeReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Boq_approvedOnBehalfById_fkey" FOREIGN KEY ("approvedOnBehalfById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoqItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boqId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unitRate" REAL NOT NULL,
    "marginPercent" REAL,
    "total" REAL NOT NULL,
    CONSTRAINT "BoqItem_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "Boq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Amc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "visitFrequency" TEXT NOT NULL,
    "coverageTypes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Amc_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Amc_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Amc_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amcId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT NOT NULL,
    "completionNote" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_amcId_fkey" FOREIGN KEY ("amcId") REFERENCES "Amc" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskImage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "auditDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalScore" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Audit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Audit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "remarks" TEXT,
    CONSTRAINT "AuditItem_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Report_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "previous" JSONB,
    "next" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "ApprovalRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApprovalRecord_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApprovalRecord_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BudgetBucket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "bucketType" TEXT NOT NULL,
    "approvedBudget" REAL NOT NULL DEFAULT 0,
    "approvedExpense" REAL NOT NULL DEFAULT 0,
    "actualPaid" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BudgetBucket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpenseRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "linkedElement" TEXT,
    "vendor" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "quotationAttachment" TEXT,
    "justification" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_FINANCE',
    "approvalId" TEXT,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "emergencyDeadlineAt" DATETIME,
    "financeReviewedById" TEXT,
    "adminReviewedById" TEXT,
    "reviewComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExpenseRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExpenseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExpenseRequest_financeReviewedById_fkey" FOREIGN KEY ("financeReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExpenseRequest_adminReviewedById_fkey" FOREIGN KEY ("adminReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorPo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "expenseRequestId" TEXT,
    "vendor" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalId" TEXT,
    "createdById" TEXT NOT NULL,
    "financeApprovedById" TEXT,
    "issuedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorPo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorPo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorPo_financeApprovedById_fkey" FOREIGN KEY ("financeApprovedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VendorPo_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "vendorPoId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "approvalId" TEXT,
    "createdById" TEXT NOT NULL,
    "financeReviewedById" TEXT,
    "adminReviewedById" TEXT,
    "paymentAuthorizationId" TEXT,
    "paymentAuthorizedAt" DATETIME,
    "paidAt" DATETIME,
    "reviewComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorInvoice_vendorPoId_fkey" FOREIGN KEY ("vendorPoId") REFERENCES "VendorPo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorInvoice_financeReviewedById_fkey" FOREIGN KEY ("financeReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VendorInvoice_adminReviewedById_fkey" FOREIGN KEY ("adminReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "hours" REAL NOT NULL,
    "workDate" DATETIME NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "locationText" TEXT,
    "markedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabourRateMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "hourlyRate" REAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabourRateMaster_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "cycleMonth" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "totalHours" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "approvalId" TEXT,
    "generatedById" TEXT NOT NULL,
    "financeReviewedById" TEXT,
    "adminReviewedById" TEXT,
    "financeComment" TEXT,
    "adminComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayrollCycle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PayrollCycle_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PayrollCycle_financeReviewedById_fkey" FOREIGN KEY ("financeReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PayrollCycle_adminReviewedById_fkey" FOREIGN KEY ("adminReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingMilestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "milestonePercent" REAL NOT NULL,
    "milestoneAmount" REAL NOT NULL,
    "gstPercent" REAL NOT NULL DEFAULT 18,
    "gstAmount" REAL NOT NULL,
    "invoiceTotal" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "dueDate" DATETIME,
    "invoiceNumber" TEXT,
    "approvalId" TEXT,
    "triggeredById" TEXT,
    "financeReviewedById" TEXT,
    "reviewComment" TEXT,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "issuedAt" DATETIME,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingMilestone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BillingMilestone_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BillingMilestone_financeReviewedById_fkey" FOREIGN KEY ("financeReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectClosure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "requestedById" TEXT,
    "financeVerifiedById" TEXT,
    "adminApprovedById" TEXT,
    "requestComment" TEXT,
    "financeComment" TEXT,
    "adminComment" TEXT,
    "requestedAt" DATETIME,
    "financeVerifiedAt" DATETIME,
    "adminApprovedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectClosure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectClosure_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProjectClosure_financeVerifiedById_fkey" FOREIGN KEY ("financeVerifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProjectClosure_adminApprovedById_fkey" FOREIGN KEY ("adminApprovedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "ChatMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percentages" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "notes" TEXT,
    "approvalId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectLedger_projectCode_fkey" FOREIGN KEY ("projectCode") REFERENCES "Project" ("projectCode") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectLedger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receivable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "billingMilestoneId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "taxableValue" REAL NOT NULL,
    "gstAmount" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "receivedAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Receivable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Receivable_projectCode_fkey" FOREIGN KEY ("projectCode") REFERENCES "Project" ("projectCode") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "exportKey" TEXT NOT NULL,
    "exportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedById" TEXT,
    CONSTRAINT "ExportLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExportLog_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_role_idx" ON "User"("companyId", "role");

-- CreateIndex
CREATE INDEX "Request_companyId_createdAt_idx" ON "Request"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Request_companyId_status_idx" ON "Request"("companyId", "status");

-- CreateIndex
CREATE INDEX "Request_createdById_createdAt_idx" ON "Request"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_code_key" ON "Client"("code");

-- CreateIndex
CREATE INDEX "Client_companyId_status_idx" ON "Client"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE INDEX "Store_companyId_city_idx" ON "Store"("companyId", "city");

-- CreateIndex
CREATE INDEX "Store_clientId_idx" ON "Store"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectCode_key" ON "Project"("projectCode");

-- CreateIndex
CREATE INDEX "Project_companyId_status_idx" ON "Project"("companyId", "status");

-- CreateIndex
CREATE INDEX "Project_companyId_projectCode_idx" ON "Project"("companyId", "projectCode");

-- CreateIndex
CREATE INDEX "Recce_companyId_status_idx" ON "Recce"("companyId", "status");

-- CreateIndex
CREATE INDEX "Recce_storeId_idx" ON "Recce"("storeId");

-- CreateIndex
CREATE INDEX "Recce_status_idx" ON "Recce"("status");

-- CreateIndex
CREATE INDEX "RecceImage_recceId_idx" ON "RecceImage"("recceId");

-- CreateIndex
CREATE INDEX "RateCard_companyId_isActive_idx" ON "RateCard"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RateCard_companyId_itemCode_key" ON "RateCard"("companyId", "itemCode");

-- CreateIndex
CREATE INDEX "Boq_companyId_status_idx" ON "Boq"("companyId", "status");

-- CreateIndex
CREATE INDEX "Boq_recceId_idx" ON "Boq"("recceId");

-- CreateIndex
CREATE INDEX "Boq_status_idx" ON "Boq"("status");

-- CreateIndex
CREATE INDEX "Boq_projectCode_idx" ON "Boq"("projectCode");

-- CreateIndex
CREATE INDEX "Boq_approvalStage_idx" ON "Boq"("approvalStage");

-- CreateIndex
CREATE INDEX "BoqItem_boqId_idx" ON "BoqItem"("boqId");

-- CreateIndex
CREATE INDEX "Amc_companyId_status_idx" ON "Amc"("companyId", "status");

-- CreateIndex
CREATE INDEX "Amc_clientId_idx" ON "Amc"("clientId");

-- CreateIndex
CREATE INDEX "Amc_storeId_idx" ON "Amc"("storeId");

-- CreateIndex
CREATE INDEX "Amc_status_idx" ON "Amc"("status");

-- CreateIndex
CREATE INDEX "Task_companyId_status_idx" ON "Task"("companyId", "status");

-- CreateIndex
CREATE INDEX "Task_storeId_idx" ON "Task"("storeId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "TaskImage_taskId_idx" ON "TaskImage"("taskId");

-- CreateIndex
CREATE INDEX "Audit_companyId_status_idx" ON "Audit"("companyId", "status");

-- CreateIndex
CREATE INDEX "Audit_storeId_idx" ON "Audit"("storeId");

-- CreateIndex
CREATE INDEX "Audit_status_idx" ON "Audit"("status");

-- CreateIndex
CREATE INDEX "AuditItem_auditId_idx" ON "AuditItem"("auditId");

-- CreateIndex
CREATE INDEX "Report_companyId_reportType_idx" ON "Report"("companyId", "reportType");

-- CreateIndex
CREATE INDEX "Report_reportType_idx" ON "Report"("reportType");

-- CreateIndex
CREATE INDEX "Report_referenceId_idx" ON "Report"("referenceId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRecord_approvalId_key" ON "ApprovalRecord"("approvalId");

-- CreateIndex
CREATE INDEX "ApprovalRecord_companyId_status_idx" ON "ApprovalRecord"("companyId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRecord_projectCode_actionType_idx" ON "ApprovalRecord"("projectCode", "actionType");

-- CreateIndex
CREATE INDEX "ApprovalRecord_status_idx" ON "ApprovalRecord"("status");

-- CreateIndex
CREATE INDEX "BudgetBucket_companyId_projectCode_idx" ON "BudgetBucket"("companyId", "projectCode");

-- CreateIndex
CREATE INDEX "BudgetBucket_projectCode_idx" ON "BudgetBucket"("projectCode");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetBucket_companyId_projectCode_bucketType_key" ON "BudgetBucket"("companyId", "projectCode", "bucketType");

-- CreateIndex
CREATE INDEX "ExpenseRequest_companyId_status_idx" ON "ExpenseRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "ExpenseRequest_projectCode_status_idx" ON "ExpenseRequest"("projectCode", "status");

-- CreateIndex
CREATE INDEX "VendorPo_companyId_status_idx" ON "VendorPo"("companyId", "status");

-- CreateIndex
CREATE INDEX "VendorPo_projectCode_status_idx" ON "VendorPo"("projectCode", "status");

-- CreateIndex
CREATE INDEX "VendorInvoice_companyId_status_idx" ON "VendorInvoice"("companyId", "status");

-- CreateIndex
CREATE INDEX "VendorInvoice_projectCode_status_idx" ON "VendorInvoice"("projectCode", "status");

-- CreateIndex
CREATE INDEX "VendorInvoice_invoiceNumber_idx" ON "VendorInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "AttendanceLog_companyId_workDate_idx" ON "AttendanceLog"("companyId", "workDate");

-- CreateIndex
CREATE INDEX "AttendanceLog_projectCode_workDate_idx" ON "AttendanceLog"("projectCode", "workDate");

-- CreateIndex
CREATE INDEX "AttendanceLog_userId_workDate_idx" ON "AttendanceLog"("userId", "workDate");

-- CreateIndex
CREATE INDEX "LabourRateMaster_companyId_isActive_idx" ON "LabourRateMaster"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LabourRateMaster_companyId_roleLabel_key" ON "LabourRateMaster"("companyId", "roleLabel");

-- CreateIndex
CREATE INDEX "PayrollCycle_companyId_status_idx" ON "PayrollCycle"("companyId", "status");

-- CreateIndex
CREATE INDEX "PayrollCycle_projectCode_status_idx" ON "PayrollCycle"("projectCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCycle_companyId_projectCode_cycleMonth_key" ON "PayrollCycle"("companyId", "projectCode", "cycleMonth");

-- CreateIndex
CREATE INDEX "BillingMilestone_companyId_status_idx" ON "BillingMilestone"("companyId", "status");

-- CreateIndex
CREATE INDEX "BillingMilestone_projectCode_status_idx" ON "BillingMilestone"("projectCode", "status");

-- CreateIndex
CREATE INDEX "ProjectClosure_companyId_status_idx" ON "ProjectClosure"("companyId", "status");

-- CreateIndex
CREATE INDEX "ProjectClosure_status_idx" ON "ProjectClosure"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectClosure_companyId_projectCode_key" ON "ProjectClosure"("companyId", "projectCode");

-- CreateIndex
CREATE INDEX "ChatMessage_companyId_createdAt_idx" ON "ChatMessage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_createdAt_idx" ON "ChatMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_receiverId_createdAt_idx" ON "ChatMessage"("receiverId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingTemplate_companyId_isDefault_idx" ON "BillingTemplate"("companyId", "isDefault");

-- CreateIndex
CREATE INDEX "ProjectLedger_companyId_projectCode_createdAt_idx" ON "ProjectLedger"("companyId", "projectCode", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectLedger_projectCode_entryType_idx" ON "ProjectLedger"("projectCode", "entryType");

-- CreateIndex
CREATE INDEX "Receivable_companyId_status_idx" ON "Receivable"("companyId", "status");

-- CreateIndex
CREATE INDEX "Receivable_projectCode_dueDate_idx" ON "Receivable"("projectCode", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_companyId_invoiceNumber_key" ON "Receivable"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "ExportLog_companyId_exportedAt_idx" ON "ExportLog"("companyId", "exportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportLog_companyId_exportType_exportKey_key" ON "ExportLog"("companyId", "exportType", "exportKey");

