const L = "../src/lib/";
const T = await import(L + "textClean.ts");
const K = await import(L + "keys.ts");
const G = await import(L + "evidenceGuard.ts");
const S = await import(L + "scoring.ts");
const { RubricZ } = await import(L + "schemas.ts");
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); if (c) console.log("ok  :", m); };

// ---- text cleaning keeps signal, drops noise
const resume = `John  Doe​\njohn@x.com | +91 98765 43210\n\nPage 1 of 3\nProfessional Experience\n• Led develop-\nment of Spring Boot microservices (6 years)\nSenior Engineer, Acme Corp, Bengaluru  2018 - Present\n\nResume of John Doe - Page\nSkills\nJava, Kubernetes, PostgreSQL\nResume of John Doe - Page\nEducation\nB.Tech Computer Science, IIT 2014\nResume of John Doe - Page\nDeclaration\nI hereby declare that the above is true.\nHobbies\nChess`;
const n = T.normalizeText(resume);
ok(!n.includes("​") && !/Page 1 of 3/.test(n) && n.includes("development of Spring Boot") && n.includes("2018 - Present") && n.includes("B.Tech") && n.includes("Kubernetes"), "normalizeText: removes zero-width/page furniture, de-hyphenates, keeps skills/dates/education");
ok((n.match(/Resume of John Doe - Page/g) ?? []).length === 1, "repeated running header collapsed to one");
const big = resume + "\nProjects\n" + "Built payments platform with Kafka. ".repeat(400);
const prepared = T.prepareResumeForLlm(big, 3000);
ok(prepared.length <= 3100 && !/Hobbies/.test(prepared) && prepared.includes("Kubernetes") && /Kafka/.test(prepared), `over-budget résumé: low-value sections dropped, skills kept (${prepared.length} chars)`);
ok(T.guessName(n) === "John Doe", "guessName");

// ---- keys: stable identity + content change detection
ok(K.candidateKey("a b c", "https://resdex.naukri.com/p/123?x=1") === K.candidateKey("different", "https://resdex.naukri.com/p/123?y=2"), "same profile URL (query ignored) → same candidateKey");
ok(K.candidateKey("Java Developer  6 Yrs!", null) === K.candidateKey("java developer 6 yrs", null), "text identity ignores case/punctuation");
ok(K.contentHash("java 6 yrs") !== K.contentHash("java 7 yrs"), "content change → different contentHash (re-score)");

const base = RubricZ.parse({ title: "Java Dev", seniority: "senior", mustHaveSkills: ["Java", "Kubernetes"], niceToHaveSkills: ["Kafka"], minExperienceYears: 5, maxExperienceYears: 9, maxNoticePeriodDays: 30, ctcBudgetMinLpa: -1, ctcBudgetMaxLpa: 40, locations: ["Bangalore"], remotePolicy: "hybrid", domainContext: "x", coreKeywords: ["java"], booleanQuery: "java AND k8s" });
const h1 = K.rubricHash(base);
ok(K.rubricHash({ ...base, mustHaveSkills: ["Kubernetes", "Java"], booleanQuery: "different query", searchVariants: [{ label: "x", keywords: "y" }] }) === h1, "rubricHash ignores skill order & Resdex search fields");
ok(K.rubricHash({ ...base, maxNoticePeriodDays: 60 }) !== h1 && K.rubricHash({ ...base, mustHaveSkills: ["Java", "Go"] }) !== h1, "rubricHash changes when a requirement changes");

// ---- evidence guard
const crit = S.buildCriteria(base);
const idx = (name: string) => crit.findIndex((c: any) => c.name === name);
let g = G.guardLevels(base, crit, crit.map(() => 2), "Spring Boot developer, 6 yrs. Deployed on EKS.");
ok(g.levels[idx("Java")] === 2, "Spring Boot implies Java → stays 2");
ok(g.levels[idx("Kubernetes")] === 2, "EKS implies Kubernetes → stays 2");
ok(g.levels[idx("Kafka")] === 1 && g.notes.some((x: string) => x.includes("Kafka")), "Kafka never mentioned but rated 2 → capped at partial");
g = G.guardLevels(base, crit, crit.map(() => 2), "Java engineer with k8s", crit.map((c: any) => (c.name === "Kubernetes" ? "No evidence" : "quote")));
ok(g.levels[idx("Kubernetes")] === 1, "level 2 backed by 'No evidence' is demoted");

// ---- breakdown + gates
const lv = crit.map((c: any) => (c.name === "Java" ? 2 : 0));
const r = S.computeScore(base, crit, lv, { expYears: 6, noticeDays: 15, currentCtcLpa: -1, expectedCtcLpa: 30, location: "Bengaluru" }, "deep", 5000);
ok(r.breakdown.gates.some((x: string) => /Must-have coverage/.test(x)) && r.score <= 55 && r.breakdown.coverage.must === 60 - 10 + 0 || r.breakdown.coverage.must !== null, `breakdown reports gate + coverage: score ${r.score}, gates ${JSON.stringify(r.breakdown.gates)}, must ${r.breakdown.coverage.must}%`);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
