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

const createRequestSchema = z.object({
  companyName: z.string().min(2),
  issueTitle: z.string().min(3),
  description: z.string().min(5),
  category: z.string().min(2).optional(),
  status: z.string().min(2).optional(),
});

const updateRequestSchema = createRequestSchema.partial();

export const requestsRouter = Router();

requestsRouter.get("/", asyncHandler(listRequests));
requestsRouter.get("/:id", asyncHandler(getRequestById));
requestsRouter.post("/", validateBody(createRequestSchema), asyncHandler(createRequest));
requestsRouter.patch("/:id", validateBody(updateRequestSchema), asyncHandler(updateRequest));
requestsRouter.delete("/:id", asyncHandler(deleteRequest));
