import path from "node:path";
import type { Express } from "express";

export interface StoredFile {
  url: string;
  mimeType: string;
  originalName: string;
  size: number;
}

export async function storeFile(file: Express.Multer.File): Promise<StoredFile> {
  // Placeholder storage adapter. Replace with S3/GCS uploader in production.
  const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`;
  return {
    url: `/uploads/${path.basename(safeName)}`,
    mimeType: file.mimetype,
    originalName: file.originalname,
    size: file.size
  };
}
