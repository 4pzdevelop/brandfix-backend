import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/async-handler";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";
import {
  createOpenAiCompletion,
  parseModelJsonObject,
} from "../services/openai.service";

const passthroughSchema = z.object({}).passthrough();

export const aiRouter = Router();

aiRouter.post(
  "/procedure-insights",
  validateBody(passthroughSchema),
  asyncHandler(async (req, res) => {
    const content = await createOpenAiCompletion({
      jsonMode: true,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are BrandFix enterprise AI. Return ONLY valid JSON with keys " +
            '"summary" and "module_insights". "module_insights" must include keys: ' +
            "smart_boq, cost_leakage, material_optimization, progress_tracking, " +
            "scheduling, snag_detection, risk_prediction, vendor_scoring, profit_intelligence. " +
            "Each module value must be a short actionable paragraph.",
        },
        {
          role: "user",
          content: JSON.stringify(req.body),
        },
      ],
    });

    const parsed = parseModelJsonObject(content);
    return ok(res, parsed);
  }),
);

aiRouter.post(
  "/boq-suggestion",
  validateBody(passthroughSchema),
  asyncHandler(async (req, res) => {
    const content = await createOpenAiCompletion({
      jsonMode: true,
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content:
            "Return ONLY valid JSON with keys: material_rate_per_sqft, " +
            "labour_rate_per_sqft, margin_percent, gst_percent, rationale. " +
            "Use realistic India retail execution rates.",
        },
        {
          role: "user",
          content: JSON.stringify(req.body),
        },
      ],
    });

    const parsed = parseModelJsonObject(content);
    return ok(res, parsed);
  }),
);

aiRouter.post(
  "/assistant",
  validateBody(
    z.object({
      query: z.string().min(1).max(3000),
    }).passthrough(),
  ),
  asyncHandler(async (req, res) => {
    const content = await createOpenAiCompletion({
      jsonMode: false,
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content:
            "You are BrandFix AI assistant for project operations. " +
            "Respond concisely with actionable details and relevant numbers.",
        },
        {
          role: "user",
          content: JSON.stringify(req.body),
        },
      ],
    });

    return ok(res, { reply: content.trim() });
  }),
);

