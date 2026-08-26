/**
 * Manual verification script: Phase 3 of the "Email Service Validation and
 * Grant Discovery AI Verification" ticket — cross-references the live AI
 * grant discovery pipeline (discoverAndEvaluateGrants) against a curated
 * ground-truth set of known-eligible Canadian home accessibility grant
 * programs, one run per modification type the app actually supports.
 *
 * Ground truth is derived from DISCOVERY_FALLBACK_SOURCE_CATALOG — a
 * manually curated, independently reviewed catalog of real programs (last
 * reviewed 2026-04) that is normally only consulted as the AI fallback.
 * Comparing it against the live AI path (which does its own web search and
 * never reads this catalog) is a legitimate, non-circular check.
 *
 * NOTE on scope: the ticket's example modification types ("ramps",
 * "walk-in tubs") were originally not present in the app's MODIFICATION_CODES
 * enum (src/backend/eligibility/types.ts) — a project couldn't express those.
 * RAMP, WHEELCHAIR_RAMP, WALK_IN_TUB, and NON_SLIP_FLOORING were added
 * 2026-08-21, so this run now covers all ten modification types the system
 * can process: GRAB_BARS, RAISED_TOILET, WALK_IN_SHOWER, WIDENED_DOORWAY,
 * STAIR_LIFT, HANDRAILS, RAMP, WHEELCHAIR_RAMP, WALK_IN_TUB, NON_SLIP_FLOORING.
 *
 * Requires: OPENAI_API_KEY set to a live key in .env. Forces
 * GRANT_DISCOVERY_MOCK_AI=false and GRANT_DISCOVERY_AI_ENABLED=true for
 * the duration of the run only (does not touch .env).
 *
 * Usage: npx tsx scripts/manual-verification/verify-grant-discovery-ground-truth.ts
 */
import "dotenv/config";
import { discoverAndEvaluateGrants } from "@/backend/eligibility/discoverySearchProvider";
import { EligibilityDecision, EligibilityInput, ModificationCode } from "@/backend/eligibility/types";

interface GroundTruthProgram {
  id: string;
  title: string;
  /** Case-insensitive substrings checked against a discovered grant's title/summary. */
  matchKeywords: string[];
  /**
   * Canonical program URL (from DISCOVERY_FALLBACK_SOURCE_CATALOG). Checked
   * against a discovered grant's sourceUrl as a match signal alongside
   * matchKeywords — the AI reliably cites the same page for a given program
   * even when it paraphrases the title differently run-to-run (observed:
   * HATC returned as "Home accessibility expenses – Personal income tax -
   * Canada.ca" in one run, Toronto's program returned as "Housing
   * Improvement Program" instead of "Home Improvement Program" in another —
   * same sourceUrl both times). Matching on the URL is far more stable
   * against LLM title/summary rewording than keyword substrings alone.
   */
  sourceUrl: string;
  /**
   * Whether this program should plausibly be ELIGIBLE for a Toronto, ON,
   * owner-occupied, consenting senior's accessibility renovation —
   * independent of which specific modification code is requested, since
   * none of these real programs restrict eligibility by modification type.
   */
  expectEligible: boolean;
  rationale: string;
}

const GROUND_TRUTH_PROGRAMS: GroundTruthProgram[] = [
  {
    id: "hatc_canada",
    title: "Home Accessibility Tax Credit (HATC)",
    matchKeywords: ["home accessibility tax credit", "hatc", "home accessibility expenses", "line 31285"],
    sourceUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31285-home-accessibility-expenses.html",
    expectEligible: true,
    rationale: "Federal credit for eligible accessibility renovation expenses generally; not modification-specific.",
  },
  {
    id: "on_rrap",
    title: "Ontario RRAP / Investment in Affordable Housing (IAH)",
    matchKeywords: ["residential rehabilitation assistance", "rrap", "investment in affordable housing", " iah"],
    sourceUrl: "https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/funding-programs/all-funding-programs/residential-rehabilitation-assistance-program",
    expectEligible: true,
    rationale: "Ontario funding for home repair/accessibility modifications for low-income seniors; not modification-specific.",
  },
  {
    id: "toronto_hip",
    title: "City of Toronto Home Improvement Program",
    matchKeywords: ["home improvement program", "toronto"],
    sourceUrl: "https://www.toronto.ca/community-people/housing-shelter/housing-support/",
    expectEligible: true,
    rationale: "Toronto forgivable loan/grant for accessibility modifications for seniors; not modification-specific.",
  },
  {
    id: "hbtc_canada",
    title: "Home Buyers' Tax Credit (HBTC)",
    matchKeywords: ["home buyers' tax credit", "home buyers tax credit", "home buyer"],
    sourceUrl: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31270-home-buyers-amount.html",
    expectEligible: false,
    rationale: "For purchasing an accessible home, not renovating an existing one — wrong grant type for any modification.",
  },
  {
    id: "cmhc_secondary_suite",
    title: "CMHC Secondary Suite Loan Program",
    matchKeywords: ["secondary suite"],
    sourceUrl: "https://www.cmhc-schl.gc.ca/en/consumers/home-buying",
    expectEligible: false,
    rationale: "For adding a secondary suite, unrelated to accessibility modifications.",
  },
  {
    id: "on_adp",
    title: "Ontario Assistive Devices Program (ADP)",
    matchKeywords: ["assistive devices program", " adp"],
    sourceUrl: "https://www.ontario.ca/page/assistive-devices-program",
    expectEligible: false,
    rationale: "Funds mobility devices/equipment, not home renovations.",
  },
];

const MODIFICATION_TYPES: ModificationCode[] = [
  "GRAB_BARS",
  "RAISED_TOILET",
  "WALK_IN_SHOWER",
  "WIDENED_DOORWAY",
  "STAIR_LIFT",
  "HANDRAILS",
  "RAMP",
  "WHEELCHAIR_RAMP",
  "WALK_IN_TUB",
  "NON_SLIP_FLOORING",
];

function buildInput(modificationCode: ModificationCode): EligibilityInput {
  return {
    project: {
      projectId: `verify-${modificationCode.toLowerCase()}`,
      projectStatus: "draft",
      address: "1 Verification Ave",
    },
    required: {
      province: "ON",
      ownershipStatus: "owner",
      clientConsentConfirmed: true,
      modificationCodes: [modificationCode],
    },
    optional: {
      name: "Verification Senior",
      email: null,
      phone: null,
      city: "Toronto",
      postalCode: null,
      ownershipOtherDetails: null,
      landlordName: null,
      landlordPhone: null,
      isCaregiver: false,
      seniorName: null,
      relationshipToSenior: null,
      caregiverConsentConfirmed: null,
    },
    missingRequiredFields: [],
    malformedDraftFields: [],
  };
}

/** Strips protocol, "www.", and a trailing slash so URL variants compare equal. */
function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function matchesProgram(
  program: GroundTruthProgram,
  discoveredTitle: string,
  discoveredSummary: string,
  discoveredSourceUrl: string | null
): boolean {
  if (discoveredSourceUrl && normalizeUrl(discoveredSourceUrl) === normalizeUrl(program.sourceUrl)) {
    return true;
  }
  const haystack = `${discoveredTitle} ${discoveredSummary}`.toLowerCase();
  return program.matchKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

interface RunOutcome {
  modificationCode: ModificationCode;
  provider: string;
  falsePositives: { program: GroundTruthProgram; confidence: string; sourceUrl: string | null }[];
  falseNegatives: GroundTruthProgram[];
  confirmed: { program: GroundTruthProgram; expected: boolean; confidence: string; sourceUrl: string | null }[];
  novel: { title: string; confidence: string; sourceUrl: string | null; decision: string }[];
}

async function main() {
  process.env.GRANT_DISCOVERY_AI_ENABLED = "true";
  process.env.GRANT_DISCOVERY_MOCK_AI = "false";

  const outcomes: RunOutcome[] = [];

  for (const modificationCode of MODIFICATION_TYPES) {
    console.log(`\n=== ${modificationCode} ===`);
    const input = buildInput(modificationCode);
    const result = await discoverAndEvaluateGrants(input);

    console.log(`provider=${result.discoveryMetadata.provider} returned=${result.discoveredGrants.length} grant(s)`);
    if (result.discoveryMetadata.aiFailureReason) {
      console.warn(`AI failure reason: ${result.discoveryMetadata.aiFailureReason}`);
    }

    const matchedProgramIds = new Set<string>();
    const falsePositives: RunOutcome["falsePositives"] = [];
    const confirmed: RunOutcome["confirmed"] = [];
    const novel: RunOutcome["novel"] = [];

    for (const grant of result.discoveredGrants) {
      const program = GROUND_TRUTH_PROGRAMS.find((p) => matchesProgram(p, grant.title, grant.summary, grant.sourceUrl));
      const isEligible = grant.decision === EligibilityDecision.ELIGIBLE;

      if (!program) {
        novel.push({
          title: grant.title,
          confidence: grant.confidence,
          sourceUrl: grant.sourceUrl,
          decision: grant.decision,
        });
        continue;
      }

      matchedProgramIds.add(program.id);
      if (isEligible && !program.expectEligible) {
        falsePositives.push({ program, confidence: grant.confidence, sourceUrl: grant.sourceUrl });
      } else {
        confirmed.push({ program, expected: program.expectEligible, confidence: grant.confidence, sourceUrl: grant.sourceUrl });
      }
    }

    const falseNegatives = GROUND_TRUTH_PROGRAMS.filter(
      (p) => p.expectEligible && !matchedProgramIds.has(p.id)
    );

    for (const fp of falsePositives) {
      console.log(`  FALSE POSITIVE: "${fp.program.title}" marked eligible (confidence=${fp.confidence}, source=${fp.sourceUrl ?? "none"}) — ${fp.program.rationale}`);
    }
    for (const fn of falseNegatives) {
      console.log(`  FALSE NEGATIVE: "${fn.title}" was not returned as eligible — expected eligible because: ${fn.rationale}`);
    }
    for (const c of confirmed) {
      console.log(`  confirmed: "${c.program.title}" — expected=${c.expected} confidence=${c.confidence} source=${c.sourceUrl ?? "none"}`);
    }
    for (const n of novel) {
      console.log(`  NOVEL (not in ground truth, flag for manual review): "${n.title}" decision=${n.decision} confidence=${n.confidence} source=${n.sourceUrl ?? "none"}`);
    }

    outcomes.push({
      modificationCode,
      provider: result.discoveryMetadata.provider,
      falsePositives,
      falseNegatives,
      confirmed,
      novel,
    });
  }

  console.log("\n\n=== SUMMARY ===");
  let totalFalsePositives = 0;
  let totalFalseNegatives = 0;
  let totalNovel = 0;
  for (const o of outcomes) {
    totalFalsePositives += o.falsePositives.length;
    totalFalseNegatives += o.falseNegatives.length;
    totalNovel += o.novel.length;
    console.log(
      `${o.modificationCode}: provider=${o.provider} falsePositives=${o.falsePositives.length} falseNegatives=${o.falseNegatives.length} novel=${o.novel.length}`
    );
  }
  console.log(`\nTOTAL: falsePositives=${totalFalsePositives} falseNegatives=${totalFalseNegatives} novel=${totalNovel}`);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
