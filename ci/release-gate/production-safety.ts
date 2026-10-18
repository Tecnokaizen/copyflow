/**
 * Release gate: CI and repository must never be able to reach Production.
 *
 * - Workflows: read-only token, no secrets (single exception: the manual
 *   Staging E2E workflow, see STAGING_E2E_WORKFLOW), no pull_request_target,
 *   no deploy / remote-migration commands, databases only on localhost.
 * - Repository: Supabase project refs only in docs, no committed env files
 *   (except the placeholder .env.example), no live-looking credentials.
 */

/** Remote Supabase projects (Production and Staging). Never targeted by CI. */
export const PROTECTED_PROJECT_REFS = ["wsclqvlzjdgwkxbolhoy", "fmmfsbhcwxkaszrrarpw"] as const;

export type SafetyFinding = { file: string; message: string };

const FORBIDDEN_WORKFLOW_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /\bpull_request_target\b/, message: "pull_request_target runs untrusted code with repository secrets" },
  { pattern: /\$\{\{\s*secrets\./, message: "workflows must not consume secrets (CI is local-only)" },
  { pattern: /\bsupabase(@[\w.]+)?\s+(db\s+push|link|migration\s+repair|functions\s+deploy)\b/, message: "remote Supabase command" },
  { pattern: /--(linked|project-ref|db-url)\b/, message: "remote Supabase target flag" },
  { pattern: /\bvercel(@[\w.]+)?\s+(deploy|--prod|promote|alias|env)\b|\bvercel(@[\w.]+)?\s+--prod\b/, message: "Vercel deployment command" },
  { pattern: /\b(SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|VERCEL_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|STRIPE_SECRET_KEY|R2_SECRET_ACCESS_KEY)\b/, message: "production credential name in workflow" },
  { pattern: /\b(contents|deployments|packages|actions|id-token|pull-requests|issues|statuses|checks):\s*write\b|\bwrite-all\b/, message: "workflow token must stay read-only" },
];

const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s"'`]*@([^:/\s"'`]+)/g;

/**
 * The only workflow allowed to read secrets: manual Staging E2E
 * (docs/E2E-STAGING-V0.md). It may read just these names, only on
 * workflow_dispatch, only through the GitHub `staging` environment.
 */
export const STAGING_E2E_WORKFLOW = ".github/workflows/e2e-staging.yml";
const STAGING_E2E_SECRETS = new Set(["E2E_USER_PASSWORD", "VERCEL_AUTOMATION_BYPASS_SECRET"]);
const AUTOMATIC_TRIGGER =
  /^\s{2}(push|pull_request|pull_request_target|pull_request_review|schedule|workflow_run|workflow_call|repository_dispatch|issue_comment|release|deployment_status|merge_group)\s*:/m;

function checkStagingE2eWorkflow(file: string, content: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  if (AUTOMATIC_TRIGGER.test(content) || !/^on:\s*\n\s{2}workflow_dispatch\s*:/m.test(content)) {
    findings.push({ file, message: "staging E2E must run on workflow_dispatch only" });
  }
  if (!/^\s+environment:\s*staging\s*$/m.test(content)) {
    findings.push({ file, message: "staging E2E must use the `staging` GitHub environment" });
  }
  for (const match of content.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)/g)) {
    if (!STAGING_E2E_SECRETS.has(match[1])) {
      findings.push({ file, message: `staging E2E may not read secret ${match[1]}` });
    }
  }
  return findings;
}

export function checkWorkflow(file: string, content: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const stagingE2e = file === STAGING_E2E_WORKFLOW;
  for (const { pattern, message } of FORBIDDEN_WORKFLOW_PATTERNS) {
    if (stagingE2e && message.startsWith("workflows must not consume secrets")) continue;
    if (pattern.test(content)) findings.push({ file, message });
  }
  if (stagingE2e) findings.push(...checkStagingE2eWorkflow(file, content));
  if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(content)) {
    findings.push({ file, message: "top-level `permissions: contents: read` is required" });
  }
  for (const match of content.matchAll(POSTGRES_URL)) {
    if (!["127.0.0.1", "localhost"].includes(match[1])) {
      findings.push({ file, message: `database URL must be local, found host ${match[1]}` });
    }
  }
  return findings;
}

const SECRET_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/, label: "Supabase secret key" },
  { pattern: /\bsk_live_[A-Za-z0-9]{16,}/, label: "Stripe live secret key" },
  { pattern: /\brk_live_[A-Za-z0-9]{16,}/, label: "Stripe live restricted key" },
  { pattern: /\bwhsec_[A-Za-z0-9]{24,}/, label: "Stripe webhook secret" },
  { pattern: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/, label: "Resend API key" },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: "private key" },
];

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]{20,}/g;

/** The well-known `supabase start` demo keys (iss "supabase-demo") are local-only. */
function isLocalDemoJwt(payload: string): boolean {
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iss?: unknown };
    return claims.iss === "supabase-demo";
  } catch {
    return false;
  }
}

export function checkTrackedFile(file: string, content: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const name = file.split("/").pop() ?? file;

  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") {
    findings.push({ file, message: "environment files must not be committed" });
  }

  if (!file.startsWith("docs/")) {
    for (const ref of PROTECTED_PROJECT_REFS) {
      if (content.includes(ref)) {
        findings.push({ file, message: `remote Supabase project ref ${ref} outside docs/` });
      }
    }
  }

  for (const { pattern, label } of SECRET_PATTERNS) {
    if (pattern.test(content)) findings.push({ file, message: `possible ${label} committed` });
  }
  for (const match of content.matchAll(JWT)) {
    if (!isLocalDemoJwt(match[1])) {
      findings.push({ file, message: "possible JWT committed" });
      break;
    }
  }

  if (name === ".env.example") {
    for (const line of content.split("\n")) {
      const assignment = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!assignment) continue;
      const value = assignment[2].trim();
      if (value && !/^(your[-_]|<|\.\.\.|https?:\/\/(localhost|127\.0\.0\.1))/i.test(value)) {
        findings.push({ file, message: `${assignment[1]} must hold a placeholder, not a value` });
      }
    }
  }
  return findings;
}
