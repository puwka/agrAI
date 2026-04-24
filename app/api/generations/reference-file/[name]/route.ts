import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../../lib/auth/api-session";
import { mimeFromExtension } from "../../../../../lib/supabase-storage";

const REFERENCES_ROOT = path.join(process.cwd(), "public", "uploads", "generations", "references");

function isInsideReferences(absPath: string) {
  const normalized = path.normalize(absPath);
  const root = path.normalize(REFERENCES_ROOT);
  return normalized === root || normalized.startsWith(root + path.sep);
}

function extFromName(name: string) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  return m ? `.${m[1].toLowerCase()}` : ".bin";
}

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name: rawName } = await context.params;
  const safeName = (rawName ?? "").trim();
  if (!safeName || safeName.includes("/") || safeName.includes("\\") || safeName.includes("..")) {
    return NextResponse.json({ error: "Некорректное имя файла" }, { status: 400 });
  }
  if (sessionUser.role !== "ADMIN" && !safeName.startsWith(`${sessionUser.id}-`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const absPath = path.join(REFERENCES_ROOT, safeName);
  if (!isInsideReferences(absPath)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const stat = await fs.stat(absPath);
    const nodeStream = createReadStream(absPath);
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    const mime = mimeFromExtension(extFromName(safeName));
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }
}
