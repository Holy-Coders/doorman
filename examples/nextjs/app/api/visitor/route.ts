import { Pool } from "pg";
import { createDoorman } from "@aarondovturkel/doorman-adapters/vercel";
export const runtime = "nodejs";
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
let doorman: ReturnType<typeof createDoorman> | undefined;
export async function POST(request: Request) {
  const secret = process.env.DOORMAN_IDENTITY_SECRET;
  if (!secret)
    return Response.json(
      { error: "Configure DOORMAN_IDENTITY_SECRET" },
      { status: 503 },
    );
  doorman ??= createDoorman({
    db,
    secret,
    namespace: "nextjs-example",
    crossDevice: true,
    evaluator: process.env.JEV_API_KEY
      ? { apiKey: process.env.JEV_API_KEY }
      : false,
  });
  // Supply auth from your existing server session, never request JSON:
  // return doorman.handle(request, { auth: { userId: session.user.id } });
  return doorman.handle(request);
}
