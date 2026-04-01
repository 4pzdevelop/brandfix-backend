# BrandFix Master Approval Flow (Implemented)

Base path: `/api`

## BOQ approval flow
1. Create BOQ draft
- `POST /boqs`
2. Submit for internal approval
- `PATCH /boqs/:id/submit-internal`
3. Finance review
- `PATCH /boqs/:id/finance-review`
4. Client review (or admin on-behalf)
- `PATCH /boqs/:id/client-review`
5. PO lock + budget freeze
- `PATCH /boqs/:id/lock-po`

## Approval log format
All financial approvals generate records in `ApprovalRecord` with:
- `approvalId`
- `projectCode`
- `actionType`
- `requestedBy`
- `approvedBy`
- `timestamp`
- `status`

Read logs:
- `GET /approvals`

## Expense & procurement approvals
1. Create expense request
- `POST /approvals/expenses`
2. Finance review
- `PATCH /approvals/expenses/:id/finance-review`
3. Admin review (escalations / breaches)
- `PATCH /approvals/expenses/:id/admin-review`
4. Vendor PO draft from approved expense
- `POST /approvals/vendor-pos`
5. Finance approve Vendor PO
- `PATCH /approvals/vendor-pos/:id/finance-review`

## Vendor invoice + payment authorization
1. Submit vendor invoice
- `POST /approvals/vendor-invoices`
2. Finance review
- `PATCH /approvals/vendor-invoices/:id/finance-review`
3. Admin review for over-PO invoices
- `PATCH /approvals/vendor-invoices/:id/admin-review`
4. Payment authorization
- `PATCH /approvals/vendor-invoices/:id/authorize-payment`

## Emergency expenses (24h window)
- Create with `isEmergency=true` in `POST /approvals/expenses`
- Auto escalation is enforced in API handlers if finance does not act within 24 hours.

## Payroll approval flow
1. Mark attendance
- `POST /approvals/attendance/mark`
2. Generate payroll cycle
- `POST /approvals/payroll/generate`
3. Finance review
- `PATCH /approvals/payroll/:id/finance-review`
4. Admin final review
- `PATCH /approvals/payroll/:id/admin-review`
5. Export allowed only after admin approval
- `GET /approvals/payroll/:id/export`

## Billing milestone flow
1. Setup milestones
- `POST /approvals/billing/milestones`
2. Trigger invoice draft
- `PATCH /approvals/billing/milestones/:id/trigger`
3. Finance review
- `PATCH /approvals/billing/milestones/:id/finance-review`
4. Register collections
- `PATCH /approvals/billing/milestones/:id/payment`

## Override + closure
- Admin override with reason log:
  - `POST /approvals/overrides`
- Project closure:
  - Request: `POST /approvals/projects/:projectCode/closure/request`
  - Finance verify: `PATCH /approvals/projects/:projectCode/closure/finance-verify`
  - Admin confirm: `PATCH /approvals/projects/:projectCode/closure/admin-confirm`

## Enforced controls
- No Vendor PO from unapproved expense.
- No vendor payment authorization without invoice approval.
- BOQ cost baseline freeze is locked after PO lock.
- Approval records are append-only via API (no delete route).
