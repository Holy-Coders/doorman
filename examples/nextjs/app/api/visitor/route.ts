import { Pool } from "pg";
import { createVercelVisitor } from "@janitor/adapters/vercel";
export const runtime = "nodejs";
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const visitor = createVercelVisitor({
  db,
  evaluator: process.env.JEV_API_KEY
    ? { apiKey: process.env.JEV_API_KEY }
    : false,
});
export async function POST(request: Request) {
  return visitor.handle(request);
}
