import ApiKeyPanel from "@/components/ApiKeyPanel";
import { getPageUser } from "@/lib/user";

export const dynamic = "force-dynamic";

const STEPS = [
  "Build the extension (cd extension && npm install && npm run build) and open chrome://extensions → enable Developer mode → Load unpacked → select extension/dist.",
  "Log in to resdex.naukri.com in Chrome, then click the Co-Pilot toolbar icon to open the Side Panel.",
  "In the side panel, log in with the SAME email and password you use here (grant the host-access prompt). Pasting the Platform URL + key below also works. Each HR gets their own isolated workspace.",
  "Pick an active job (or paste an ad-hoc JD). Optionally click “Auto-Fill Resdex Search” — then run a simple keyword search on Resdex yourself.",
  "Candidate cards get match badges automatically; open a candidate profile to see the deep audit and click “Save & Shortlist to Platform”.",
];

export default async function ExtensionSetupPage() {
  const user = await getPageUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Extension setup</h1>
        <p className="text-sm text-slate-500">Connect the Chrome extension to this workspace.</p>
      </div>
      <ApiKeyPanel initialKey={user.extensionApiKey} />
      <div className="card p-5">
        <h2 className="mb-3 font-semibold">Quick setup</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-4 rounded bg-amber-50 p-3 text-xs text-amber-800">
          The extension only reads what is already on your screen — it never clicks, paginates or sends requests to Naukri on your behalf. Treat the API key like a password.
        </p>
      </div>
    </div>
  );
}
