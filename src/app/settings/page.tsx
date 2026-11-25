import LlmKeysPanel from "@/components/LlmKeysPanel";
import { getPageUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getPageUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">
          Signed in as <b>{user.name || user.email}</b> ({user.email}). Your jobs, rubrics, candidates, resumes and searches are visible only to you.
        </p>
      </div>
      <LlmKeysPanel />
    </div>
  );
}
