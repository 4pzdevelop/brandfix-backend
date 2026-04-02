import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/async-handler";
import { validateBody } from "../middleware/validate";
import {
  createRequest,
  deleteRequest,
  getRequestById,
  listRequests,
  updateRequest,
} from "../controllers/requests.controller";

const createRequestSchema = z
  .object({
    companyId: z.string().min(1).optional(),
    companyName: z.string().min(2).optional(),
    issueTitle: z.string().min(3).optional(),
    title: z.string().min(3).optional(),
    description: z.string().min(5),
    category: z.string().min(2).optional(),
    status: z.string().min(2).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.issueTitle && !value.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either issueTitle or title is required",
        path: ["issueTitle"],
      });
    }
  });

const updateRequestSchema = z.object({
  companyId: z.string().min(1).optional(),
  companyName: z.string().min(2).optional(),
  issueTitle: z.string().min(3).optional(),
  title: z.string().min(3).optional(),
  description: z.string().min(5).optional(),
  category: z.string().min(2).optional(),
  status: z.string().min(2).optional(),
});

export const requestsRouter = Router();

requestsRouter.get("/", asyncHandler(listRequests));
requestsRouter.get("/:id", asyncHandler(getRequestById));
requestsRouter.post("/", validateBody(createRequestSchema), asyncHandler(createRequest));
requestsRouter.patch("/:id", validateBody(updateRequestSchema), asyncHandler(updateRequest));
requestsRouter.delete("/:id", asyncHandler(deleteRequest));
