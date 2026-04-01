import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@brandfix/types";

export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Forbidden for your role" });
    }

    next();
  };
}
