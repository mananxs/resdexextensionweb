import type { Criterion } from "./scoring";
import type { Rubric } from "./schemas";

/**
 * Anti-hallucination guard between the LLM's per-criterion levels and the deterministic scorer.
 * The model proposes levels; this checks them against the text it was shown:
 *   • a TECH skill rated present but never mentioned (nor an alias / implying tool) is capped to "partial";
 *   • with an evidence string: "level 2" backed by "No evidence"/empty is demoted;
 *   • a DEAL-BREAKER (which caps the score at 30) must have evidence in deep mode, otherwise it is treated as "unclear".
 * It only ever LOWERS a level, and only with a concrete reason, so it cannot invent matches.
 */

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

/** 1–3 word windows of the text, compacted: "Node.js" → {node, js, nodejs}; "Spring Boot" → {spring, boot, springboot}. */
function gramSet(text: string): Set<string> {
  const toks = text.toLowerCase().match(/[a-z0-9+#]+/g) ?? [];
  const set = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    let g = "";
    for (let n = 0; n < 3 && i + n < toks.length; n++) {
      g += toks[i + n];
      set.add(g);
    }
  }
  return set;
}

/** compact(skill) → compact terms that IMPLY it (a profile saying "Django" proves Python). */
const IMPLIED_BY: Record<string, string[]> = {
  java: ["springboot", "spring", "hibernate", "jsp", "servlet", "servlets", "j2ee", "jee", "maven", "gradle", "kotlin"],
  javascript: ["js", "typescript", "ts", "nodejs", "react", "reactjs", "angular", "angularjs", "vue", "vuejs", "nextjs", "jquery", "es6"],
  typescript: ["ts", "nestjs", "angular"],
  react: ["reactjs", "nextjs", "reactnative", "gatsby", "remix", "redux"],
  nodejs: ["node", "express", "expressjs", "nestjs", "koa", "fastify"],
  python: ["django", "flask", "fastapi", "pandas", "numpy", "pyspark", "pytorch", "tensorflow", "py"],
  kubernetes: ["k8s", "eks", "aks", "gke", "openshift", "helm"],
  docker: ["containerization", "containers", "dockerfile", "dockercompose"],
  aws: ["amazonwebservices", "ec2", "s3", "lambda", "cloudformation", "eks", "rds", "dynamodb"],
  azure: ["azuredevops", "aks", "azurefunctions"],
  gcp: ["googlecloud", "googlecloudplatform", "bigquery", "gke"],
  sql: ["mysql", "postgresql", "postgres", "oracle", "sqlserver", "mssql", "plsql", "tsql", "mariadb"],
  postgresql: ["postgres", "psql"],
  mongodb: ["mongo", "mongoose"],
  spark: ["pyspark", "databricks"],
  cicd: ["jenkins", "githubactions", "gitlabci", "circleci", "azuredevops", "teamcity"],
  rest: ["restapi", "restful", "restapis"],
  microservices: ["microservice", "springcloud"],
  html: ["html5"],
  css: ["css3", "sass", "scss", "tailwind", "tailwindcss"],
  ml: ["machinelearning"],
  machinelearning: ["ml", "scikitlearn", "sklearn", "xgboost"],
  csharp: ["c#", "dotnet", "net", "aspnet"],
  dotnet: ["net", "aspnet", "csharp", "c#"],
};

/** Common spelling/abbreviation twins so "ReactJS" satisfies "React" and "Postgres" satisfies "PostgreSQL". */
function variants(term: string): string[] {
  const c = compact(term);
  const out = new Set([c]);
  if (c.endsWith("js")) out.add(c.slice(0, -2));
  else out.add(`${c}js`);
  if (c === "golang") out.add("go");
  if (c === "k8s") out.add("kubernetes");
  if (c === "postgres") out.add("postgresql");
  if (c === "amazonwebservices") out.add("aws");
  return [...out].filter((v) => v.length >= 2);
}

export function termPresent(grams: Set<string>, term: string, extra: string[] = []): boolean {
  const all = [term, ...extra].flatMap(variants);
  for (const v of all) {
    if (grams.has(v)) return true;
    for (const imp of IMPLIED_BY[v] ?? []) if (grams.has(imp)) return true;
  }
  return false;
}

const NO_EVIDENCE = /^\s*(no evidence|none|n\/a|not (mentioned|found|stated|present)|absent|-)?\s*\.?$/i;

export interface GuardResult {
  levels: number[];
  /** Human-readable reasons, surfaced in audit flags when something was demoted. */
  notes: string[];
}

export function guardLevels(rubric: Rubric, criteria: Criterion[], levels: number[], text: string, evidence?: (string | undefined)[]): GuardResult {
  const grams = gramSet(text);
  const out = [...levels];
  const notes: string[] = [];
  const aliasesOf = (s: string) => rubric.skillAliases.find((a) => a.skill.trim().toLowerCase() === s.trim().toLowerCase())?.aliases ?? [];

  criteria.forEach((c, i) => {
    const lvl = Math.max(0, Math.min(2, Math.round(out[i] ?? 0)));
    out[i] = lvl;
    const ev = evidence?.[i];
    const hasEvidence = evidence ? !NO_EVIDENCE.test(ev ?? "") : true;

    if (c.kind === "dealbreaker") {
      if (lvl === 2 && evidence && !hasEvidence) {
        out[i] = 1; // a hard cap needs a quote
        notes.push(`Unverified deal-breaker ignored: ${c.name}`);
      }
      return;
    }
    if (c.kind !== "skill" || lvl === 0) return;

    if (evidence && !hasEvidence) {
      out[i] = lvl === 2 ? 1 : 0;
      notes.push(`"${c.name}" rated without evidence`);
      return;
    }
    const words = c.name.trim().split(/\s+/).length;
    if (words <= 2 && !termPresent(grams, c.name, aliasesOf(c.name)) && lvl > 1) {
      out[i] = 1; // tech-like skill never mentioned (or implied) in the text → at most partial
      notes.push(`"${c.name}" not found in the text — capped at partial`);
    }
  });
  return { levels: out, notes };
}
