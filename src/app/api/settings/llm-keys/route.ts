import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret, encryptSecret, maskKey } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import { handleDash } from "@/lib/http";
import { sharedKeys } from "@/lib/llmRouter";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const split = (s: string | null) => (s ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

function view(u: { groqKeysEnc: string | null; geminiKeysEnc: string | null; useSharedKeys: boolean }) {
  return {
    groq: split(decryptSecret(u.groqKeysEnc)).map(maskKey),
    gemini: split(decryptSecret(u.geminiKeysEnc)).map(maskKey),
    useShared: u.useSharedKeys,
    shared: { groq: sharedKeys("groq").length, gemini: sharedKeys("gemini").length },
  };
}

/** Never returns a full key — only the last 4 characters of each stored key. */
export function GET(req: Request) {
  return handleDash(req, async (user) => NextResponse.json(view(user)));
}

const KEY_RE = {
  groq: /^gsk_[A-Za-z0-9]{20,}$/,
  gemini: /^AIza[A-Za-z0-9_\-]{30,}$/,
};

const Body = z.object({
  /** undefined = leave as is · [] = remove all · [...] = replace with these keys */
  groq: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  gemini: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  useShared: z.boolean().optional(),
});

export function PUT(req: Request) {
  return handleDash(req, async (user) => {
    const b = Body.parse(await req.json().catch(() => ({})));
    for (const [prov, list] of [["groq", b.groq], ["gemini", b.gemini]] as const)
      for (const k of list ?? []) if (!KEY_RE[prov].test(k)) throw new HttpError(400, `That doesn't look like a ${prov === "groq" ? "Groq (gsk_…)" : "Gemini (AIza…)"} API key`);

    const nextGroq = b.groq === undefined ? undefined : b.groq.length ? encryptSecret([...new Set(b.groq)].join(",")) : null;
    const nextGem = b.gemini === undefined ? undefined : b.gemini.length ? encryptSecret([...new Set(b.gemini)].join(",")) : null;
    const effectiveGroq = nextGroq === undefined ? user.groqKeysEnc : nextGroq;
    const effectiveGem = nextGem === undefined ? user.geminiKeysEnc : nextGem;
    const useShared = b.useShared ?? user.useSharedKeys;
    // "own keys only" with no own keys would leave the HR unable to score anything
    if (!useShared && !effectiveGroq && !effectiveGem) throw new HttpError(400, "Add at least one key of your own, or keep the shared pool enabled");

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { ...(nextGroq !== undefined && { groqKeysEnc: nextGroq }), ...(nextGem !== undefined && { geminiKeysEnc: nextGem }), useSharedKeys: useShared },
    });
    return NextResponse.json(view(updated));
  });
}
