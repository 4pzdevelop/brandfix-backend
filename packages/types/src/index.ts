export type UserRole = "ADMIN" | "FINANCE" | "OPERATIONS" | "FIELD_EXECUTIVE" | "CLIENT";

export type StatusBadge =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "INTERNAL_REVIEW"
  | "FINANCE_APPROVED"
  | "CLIENT_APPROVED"
  | "PENDING_FINANCE"
  | "PENDING_ADMIN"
  | "ESCALATED_ADMIN"
  | "ACTIVE"
  | "EXPIRED"
  | "RENEWED"
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED";

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  companyId?: string;
  companyCode?: string;
  location?: string | null;
  clientId?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken?: string;
  user: AuthUser;
}

export interface Client {
  id: string;
  name: string;
  code: string;
  industry?: string | null;
  primaryContact?: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

export interface Store {
  id: string;
  clientId: string;
  name: string;
  code: string;
  storeType: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  amcStatus: "NONE" | "ACTIVE" | "EXPIRED";
  createdAt: string;
}

export interface RecceMeasurement {
  section: string;
  length: number;
  width: number;
  height: number;
  unit: "ft" | "m";
}

export interface RecceImage {
  id: string;
  url: string;
  category: "SIGNAGE" | "VM" | "LIGHTING" | "BRANDING" | "OTHER";
  capturedAt: string;
}

export interface Recce {
  id: string;
  storeId: string;
  visitDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  notes?: string | null;
  measurements: RecceMeasurement[];
  conditionSummary: Record<string, string>;
  images: RecceImage[];
  createdByName?: string;
  createdByRole?: UserRole;
  createdByLocation?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ChatContact {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  location?: string | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  createdAt: string;
  senderName: string;
  senderRole: UserRole;
}

export interface BoqItem {
  id: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unitRate: number;
  marginPercent?: number | null;
  total: number;
}

export interface Boq {
  id: string;
  recceId: string;
  projectCode?: string | null;
  version?: number;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  approvalStage?: "DRAFT" | "INTERNAL_REVIEW" | "FINANCE_APPROVED" | "CLIENT_APPROVED" | "REJECTED";
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  poNumber?: string | null;
  budgetFrozenAt?: string | null;
  items: BoqItem[];
  approvedBy?: string | null;
}

export type ApprovalActionType =
  | "BOQ_APPROVAL"
  | "BUDGET_FREEZE"
  | "EXPENSE_APPROVAL"
  | "VENDOR_PO_APPROVAL"
  | "VENDOR_INVOICE_APPROVAL"
  | "EMERGENCY_EXPENSE_APPROVAL"
  | "PAYROLL_APPROVAL"
  | "BILLING_INVOICE_APPROVAL"
  | "PAYMENT_AUTHORIZATION"
  | "OVERRIDE_APPROVAL"
  | "PROJECT_CLOSURE";

export type ApprovalRecordStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "ESCALATED"
  | "AUTO_ESCALATED"
  | "POLICY_BREACH";

export interface ApprovalRecord {
  approvalId: string;
  projectCode: string;
  actionType: ApprovalActionType;
  requestedBy: string;
  approvedBy?: string | null;
  status: ApprovalRecordStatus;
  timestamp: string;
  comments?: string | null;
}

export interface Amc {
  id: string;
  clientId: string;
  storeId: string;
  startDate: string;
  endDate: string;
  visitFrequency: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY";
  coverageTypes: string[];
  status: "ACTIVE" | "EXPIRED" | "RENEWED";
}

export interface ExecutionTask {
  id: string;
  storeId: string;
  amcId?: string | null;
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
}

export interface AuditChecklistItem {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  remarks?: string;
}

export interface StoreAudit {
  id: string;
  storeId: string;
  auditDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  totalScore: number;
  maxScore: number;
  checklist: AuditChecklistItem[];
}

export interface ReportFile {
  id: string;
  reportType: "RECCE" | "BOQ" | "AMC" | "AUDIT";
  referenceId: string;
  generatedAt: string;
  generatedBy: string;
  fileUrl: string;
}
