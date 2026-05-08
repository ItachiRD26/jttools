// ─────────────────────────────────────────────
//  JT Tools — Admin: Revoke a specific key
//  DELETE /api/admin/keys/[key]
// ─────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/api-auth";

function isAdmin(req: NextRequest): boolean {
  return req.headers.get("x-admin-secret") === process.env.ADMIN_SECRET;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;
  await revokeApiKey(key);

  return NextResponse.json({ message: `Key ${key} revoked.` });
}