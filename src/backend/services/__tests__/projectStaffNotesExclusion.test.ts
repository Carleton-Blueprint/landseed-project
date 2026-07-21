import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PROJECT_ROOT = join(__dirname, "../../../..");

function findFilesContaining(rootDir: string, needle: string, excludeDirName: string): string[] {
  const matches: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === excludeDirName) continue;
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
      } else if (stats.isFile() && readFileSync(fullPath, "utf-8").includes(needle)) {
        matches.push(relative(PROJECT_ROOT, fullPath));
      }
    }
  }

  walk(rootDir);
  return matches;
}

const CLIENT_FACING_SURFACES = [
  "src/app/api/project/route.ts",
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/[id]/page.tsx",
  "src/app/projects/[id]/estimate/page.tsx",
  "src/app/api/intake-draft/route.ts",
  "src/app/api/documents/list/[projectId]/route.ts",
  "src/app/api/project/[id]/communication-history/route.ts",
  "src/app/api/eligibility/[projectId]/route.ts",
  "src/backend/services/personalDataExport.ts",
  "src/backend/services/manualFallbackExport.ts",
] as const;

const ALLOWED_PROJECT_STAFF_NOTE_IMPORT_PATTERNS = [
  /src\/app\/api\/admin\/projects\//,
  /src\/backend\/services\/projectStaffNotes\.ts$/,
  /src\/backend\/services\/__tests__\//,
];

function readProjectFile(relativePath: string): string {
  return readFileSync(join(PROJECT_ROOT, relativePath), "utf-8");
}

describe("ProjectStaffNote client exclusion", () => {
  it("manual fallback export select omits staffNotes relation", () => {
    const source = readProjectFile("src/backend/services/manualFallbackExport.ts");
    const selectStart = source.indexOf("export const MANUAL_FALLBACK_PROJECT_SELECT");
    const selectEnd = source.indexOf("} satisfies Prisma.ProjectSelect;", selectStart);

    expect(selectStart).toBeGreaterThanOrEqual(0);
    expect(selectEnd).toBeGreaterThan(selectStart);

    const selectBlock = source.slice(selectStart, selectEnd);
    expect(selectBlock).not.toMatch(/staffNotes\s*:/);
    expect(selectBlock).not.toMatch(/prisma\.projectStaffNote/);
  });

  it("manual fallback project.json snapshot omits staff note fields", () => {
    const source = readProjectFile("src/backend/services/manualFallbackExport.ts");
    const projectJsonBlock = source.slice(
      source.indexOf('"project.json"'),
      source.indexOf('"quotes.json"')
    );

    expect(projectJsonBlock).not.toMatch(/staffNotes\s*:/);
    expect(projectJsonBlock).not.toMatch(/prisma\.projectStaffNote/);
  });

  it.each(CLIENT_FACING_SURFACES)("does not query staff notes in %s", (relativePath) => {
    const source = readProjectFile(relativePath);

    expect(source).not.toMatch(/staffNotes\s*:/);
    expect(source).not.toMatch(/prisma\.projectStaffNote/);
    expect(source).not.toMatch(/from ["']@\/backend\/services\/projectStaffNotes/);
  });

  it("limits projectStaffNotes service imports to admin routes and service tests", () => {
    const matches = findFilesContaining(join(PROJECT_ROOT, "src"), "projectStaffNotes", "__tests__");

    const unexpected = matches.filter(
      (file) => !ALLOWED_PROJECT_STAFF_NOTE_IMPORT_PATTERNS.some((pattern) => pattern.test(file))
    );

    expect(unexpected).toEqual([]);
  });
});
