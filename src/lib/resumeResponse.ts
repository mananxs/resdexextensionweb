import { NextResponse } from "next/server";

/**
 * Sends stored résumé bytes. Only PDFs may render inline (`?inline=1`); everything else is forced to download, and
 * nosniff + a sandbox CSP stop a hostile file from running script on our origin.
 */
export function fileResponse(fileName: string, mime: string, data: Uint8Array, inline: boolean) {
  const safe = fileName.replace(/[^\w.\- ]+/g, "_");
  const showInline = inline && mime === "application/pdf";
  return new NextResponse(data as unknown as BodyInit, {
    headers: {
      "Content-Type": mime || "application/octet-stream",
      "Content-Disposition": `${showInline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(data.byteLength),
      "X-Content-Type-Options": "nosniff",
      // `sandbox` breaks Chrome's built-in PDF viewer, so it is only applied to downloads; an inline PDF is rendered by the
      // browser's own sandboxed viewer and cannot run script in our origin.
      ...(showInline ? {} : { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }),
      "Cache-Control": "private, no-store",
    },
  });
}
