import { MODIFICATION_CODES, ModificationCode } from "@/backend/eligibility/types";

export interface ModificationCostCatalogEntry {
  label: string;
  searchQuery: string;
  fallbackUnitPrice: number;
}

/**
 * fallbackUnitPrice values are placeholder estimates (materials-only baseline;
 * labor is computed separately in refinedEstimate.ts) used only when SerpAPI
 * returns no usable result. They are not sourced from a vetted pricing sheet
 * and should be replaced with vetted figures before being treated as authoritative.
 */
export const MODIFICATION_COST_CATALOG: Record<ModificationCode, ModificationCostCatalogEntry> = {
  [MODIFICATION_CODES.GRAB_BARS]: {
    label: "Grab Bars",
    searchQuery: "ADA grab bar bathroom safety rail",
    fallbackUnitPrice: 180, // placeholder: ADA-compliant bar set + mounting hardware
  },
  [MODIFICATION_CODES.RAISED_TOILET]: {
    label: "Raised Toilet",
    searchQuery: "raised comfort height toilet accessible",
    fallbackUnitPrice: 320, // placeholder: comfort-height toilet unit + seat
  },
  [MODIFICATION_CODES.WALK_IN_SHOWER]: {
    label: "Walk-In Shower",
    searchQuery: "low threshold walk-in shower kit accessible",
    fallbackUnitPrice: 4800, // placeholder: low-threshold shower conversion kit, materials only
  },
  [MODIFICATION_CODES.WIDENED_DOORWAY]: {
    label: "Widened Doorway",
    searchQuery: "36 inch accessible door widening kit",
    fallbackUnitPrice: 950, // placeholder: door + frame widening materials
  },
  [MODIFICATION_CODES.STAIR_LIFT]: {
    label: "Stair Lift",
    searchQuery: "residential straight stair lift chair",
    fallbackUnitPrice: 8200, // placeholder: straight stair lift unit, materials only
  },
  [MODIFICATION_CODES.HANDRAILS]: {
    label: "Handrails",
    searchQuery: "interior handrail safety railing kit",
    fallbackUnitPrice: 150, // placeholder: interior handrail kit + brackets
  },
};

export const UNSPECIFIED_MODIFICATION_LABEL = "Other Modifications";
