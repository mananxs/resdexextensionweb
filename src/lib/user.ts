import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { getSessionUser, requireUser } from "./auth";

export function generateApiKey() {
  return `rsx_${randomBytes(24).toString("hex")}`;
}

/**
 * The logged-in HR (session cookie). Multi-tenant: there is no shared/default user any more.
 *  • API routes:   `getCurrentUser()` → throws HttpError(401) when logged out (turned into JSON by `handleDash`).
 *  • Server pages: `getPageUser()`    → redirects to /login.
 */
export const getCurrentUser = requireUser;

export async function getPageUser() {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}
