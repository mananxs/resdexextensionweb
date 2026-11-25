import { NextRequest } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { handleExt, json, preflight } from "@/lib/http";
import { sharedKeys } from "@/lib/llmRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const count = (s: string | null) => (decryptSecret(s) ?? "").split(/[\s,;]+/).filter(Boolean).length;

/** Who is this key? Used by the extension to show the logged-in HR and to detect a revoked/rotated key. */
export function GET(req: NextRequest) {
  return handleExt(req, async (user) =>
    json({
      user: { id: user.id, email: user.email, name: user.name },
      llm: {
        ownGroqKeys: count(user.groqKeysEnc),
        ownGeminiKeys: count(user.geminiKeysEnc),
        useShared: user.useSharedKeys,
        sharedGroqKeys: sharedKeys("groq").length,
        sharedGeminiKeys: sharedKeys("gemini").length,
      },
    }),
  );
}
