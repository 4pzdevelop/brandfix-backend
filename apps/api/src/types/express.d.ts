import type { UserRole } from "@brandfix/types";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        email: string;
        companyId: string;
      };
    }
  }
}

export {};
