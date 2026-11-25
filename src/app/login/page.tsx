import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect("/jobs");
  const { next } = await searchParams;
  return <AuthForm mode="login" next={next} />;
}
