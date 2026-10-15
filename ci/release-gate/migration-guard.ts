/**
 * Release gate: migration safety.
 *
 * 1. Applied migrations are immutable: a PR may only ADD files under
 *    supabase/migrations. Modifications, deletions and renames fail.
 * 2. New migrations must sort after every existing one.
 * 3. New migrations are scanned for destructive or security-sensitive
 *    statements. A finding can be acknowledged explicitly inside the file:
 *
 *      -- release-gate: allow <rule>: <reason of at least 10 characters>
 *
 *    so the decision is visible in review. Some rules cannot be waived.
 *
 * The scanner is deliberately conservative and syntactic: comments and
 * quoted literals are ignored; function bodies are ignored (their DML runs
 * only when called), but anonymous DO blocks are scanned because they run at
 * migration time.
 */

export const MIGRATIONS_DIR = "supabase/migrations/";

const MIGRATION_NAME = /^(\d{14})_[a-z0-9_-]+\.sql$/;

export type RuleId =
  | "destructive-ddl"
  | "data-deletion"
  | "rls-disable"
  | "public-grant"
  | "definer-search-path";

const NON_WAIVABLE: ReadonlySet<RuleId> = new Set(["definer-search-path"]);

export type Finding = {
  file: string;
  rule: RuleId | "immutable-migration" | "migration-name" | "migration-order";
  message: string;
  waived?: string;
};

export type MigrationChange = {
  status: string; // git --name-status letter(s): A, M, D, R100, C075, T
  path: string;
  previousPath?: string;
};

type Rule = { id: RuleId; pattern: RegExp; message: string };

// Applied to SQL with comments, literals and function bodies removed.
const RULES: Rule[] = [
  {
    id: "destructive-ddl",
    pattern: /\bdrop\s+(table|schema|column|view|materialized\s+view|type|function|procedure|policy|sequence|extension)\b/i,
    message: "DROP of a schema object breaks the previous code version (expand-contract) or loses data",
  },
  {
    id: "destructive-ddl",
    pattern: /\balter\s+table\b[^;]*\b(rename\b|alter\s+column\b[^;]*\btype\b)/i,
    message: "RENAME or column TYPE change is not backward compatible",
  },
  // Statement-level only: TRUNCATE/DELETE also appear as privilege names.
  {
    id: "data-deletion",
    pattern: /(^|[\s(;]|\$)\s*truncate\s+(table\s+)?(only\s+)?[\w."]+\s*(,|;|$|\b(restart|continue|cascade|restrict)\b)/i,
    message: "TRUNCATE deletes data",
  },
  {
    id: "data-deletion",
    pattern: /(^|[\s(;]|\$)\s*delete\s+from\s+[\w."]+/i,
    message: "DELETE executed at migration time deletes data",
  },
  {
    id: "rls-disable",
    pattern: /\b(disable|no\s+force)\s+row\s+level\s+security\b/i,
    message: "Row level security must not be disabled",
  },
  {
    id: "rls-disable",
    pattern: /\bdisable\s+trigger\b/i,
    message: "Disabling triggers bypasses tenant and integrity guards",
  },
  {
    id: "public-grant",
    pattern: /\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i,
    message: "GRANT to anon/PUBLIC exposes objects to unauthenticated callers",
  },
];

/** Replaces '...' literals and -- / block comments with spaces. */
function stripCommentsAndLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") break;
        i += 1;
      }
      i += 1;
      out += "''";
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        out += sql.slice(i, stop); // bodies handled per statement below
        i = stop;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Splits on top-level semicolons (dollar-quoted bodies may contain them). */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        current += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (sql[i] === ";") {
      statements.push(current);
      current = "";
    } else {
      current += sql[i];
    }
    i += 1;
  }
  if (current.trim()) statements.push(current);
  return statements;
}

const DOLLAR_BODY = /\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g;

function isRoutineDefinition(statement: string): boolean {
  return /^\s*create\s+(or\s+replace\s+)?(function|procedure)\b/i.test(statement);
}

function isDoBlock(statement: string): boolean {
  return /^\s*do\b/i.test(statement);
}

/** Executable SQL of one statement: routine bodies removed, DO bodies kept. */
function executableText(statement: string): string {
  if (isDoBlock(statement)) {
    return statement.replace(DOLLAR_BODY, (body) => body.replace(/^\$[A-Za-z0-9_]*\$|\$[A-Za-z0-9_]*\$$/g, " "));
  }
  return statement.replace(DOLLAR_BODY, " ");
}

export type Waivers = Map<RuleId, string>;

export function parseWaivers(sql: string): { waivers: Waivers; invalid: string[] } {
  const waivers: Waivers = new Map();
  const invalid: string[] = [];
  const pattern = /--\s*release-gate:\s*allow\s+([a-z-]+)\s*:\s*(.*)$/gim;
  for (const match of sql.matchAll(pattern)) {
    const rule = match[1] as RuleId;
    const reason = match[2].trim();
    const known = RULES.some((r) => r.id === rule) || rule === "definer-search-path";
    if (!known || reason.length < 10 || NON_WAIVABLE.has(rule)) {
      invalid.push(match[0].trim());
      continue;
    }
    waivers.set(rule, reason);
  }
  return { waivers, invalid };
}

export function scanMigrationSql(file: string, sql: string): Finding[] {
  const findings: Finding[] = [];
  const { waivers, invalid } = parseWaivers(sql);
  for (const entry of invalid) {
    findings.push({
      file,
      rule: "destructive-ddl",
      message: `invalid release-gate waiver (unknown rule, non-waivable rule or reason < 10 chars): ${entry}`,
    });
  }

  const seen = new Set<string>();
  for (const statement of splitStatements(stripCommentsAndLiterals(sql))) {
    if (isRoutineDefinition(statement)) {
      const header = statement.replace(DOLLAR_BODY, " ");
      if (/\bsecurity\s+definer\b/i.test(header) && !/\bset\s+search_path\b/i.test(header)) {
        const name = /\b(?:function|procedure)\s+([\w."]+)/i.exec(header)?.[1] ?? "routine";
        findings.push({
          file,
          rule: "definer-search-path",
          message: `SECURITY DEFINER ${name} must pin search_path (SET search_path TO '')`,
        });
      }
      continue;
    }

    const text = executableText(statement);
    for (const rule of RULES) {
      const match = rule.pattern.exec(text);
      if (!match) continue;
      const key = `${rule.id}:${rule.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        file,
        rule: rule.id,
        message: `${rule.message} (\`${match[0].replace(/\s+/g, " ").trim()}\`)`,
        ...(waivers.has(rule.id) ? { waived: waivers.get(rule.id) } : {}),
      });
    }
  }
  return findings;
}

export function migrationVersion(path: string): string | null {
  const name = path.startsWith(MIGRATIONS_DIR) ? path.slice(MIGRATIONS_DIR.length) : path;
  return MIGRATION_NAME.exec(name)?.[1] ?? null;
}

/**
 * @param changes      git name-status entries under supabase/migrations
 * @param baseFiles    migration paths that exist on the base revision
 * @param readNewFile  content of an added migration at HEAD
 */
export function checkMigrationChanges(
  changes: readonly MigrationChange[],
  baseFiles: readonly string[],
  readNewFile: (path: string) => string
): Finding[] {
  const findings: Finding[] = [];
  const baseVersions = baseFiles
    .map(migrationVersion)
    .filter((v): v is string => v !== null)
    .sort();
  const latestBase = baseVersions[baseVersions.length - 1] ?? "";

  for (const change of changes) {
    if (!change.path.startsWith(MIGRATIONS_DIR) || !change.path.endsWith(".sql")) continue;
    const kind = change.status[0];

    if (kind !== "A") {
      findings.push({
        file: change.previousPath ?? change.path,
        rule: "immutable-migration",
        message: `applied migrations are immutable (git status ${change.status}); add a new forward migration instead`,
      });
      continue;
    }

    const version = migrationVersion(change.path);
    if (!version) {
      findings.push({
        file: change.path,
        rule: "migration-name",
        message: "migration file must be named <YYYYMMDDHHMMSS>_<name>.sql",
      });
    } else if (version <= latestBase) {
      findings.push({
        file: change.path,
        rule: "migration-order",
        message: `version ${version} must be newer than the latest existing migration ${latestBase}`,
      });
    }

    findings.push(...scanMigrationSql(change.path, readNewFile(change.path)));
  }
  return findings;
}

export function blockingFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => !f.waived);
}
