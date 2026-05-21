import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

export const UPLOADS_DIR = resolve("./data/uploads");
mkdirSync(UPLOADS_DIR, { recursive: true });

export function uploadPath(id: string): string {
  return join(UPLOADS_DIR, id);
}
