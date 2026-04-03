import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(12),
  JWT_REFRESH_SECRET: z.string().min(12),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default("8h"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(8),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1")
});

export const env = envSchema.parse(process.env);
