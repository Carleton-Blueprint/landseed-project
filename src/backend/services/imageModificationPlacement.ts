/**
 * Per-modification placement rules for the accessibility visual edit prompt.
 *
 * Without these, gpt-image-1 only gets a label ("Grab Bars") and tends to
 * scatter the item around the room — bars on vanities, doors and open walls,
 * several of them at random heights. Each rule tells the model how many to
 * add, where they belong, how they're mounted, how big they are, and what
 * never to do, so the rendering resembles a real installation.
 */
import type { ModificationCode } from "@/backend/eligibility/types";

export interface ModificationPlacementRule {
  quantity: string;
  placement: string;
  mounting: string;
  scale: string;
  never: string[];
}

export const MODIFICATION_PLACEMENT_RULES: Record<ModificationCode, ModificationPlacementRule> = {
  GRAB_BARS: {
    quantity: "1–2 bars in total.",
    placement:
      "Only on the wall directly beside the toilet, or on the wall inside the shower or above the tub rim.",
    mounting:
      "Mounted horizontally (or vertically at a shower entry), anchored to the wall with round flanges at both ends, 33–36 inches (84–91 cm) above the floor.",
    scale:
      "12–36 inches long, about 1.25–1.5 inches in diameter, brushed stainless steel or a finish matching the existing fixtures.",
    never: [
      "Never place bars on vanities, countertops, cabinets, mirrors, doors or windows.",
      "Never place bars on open walls away from the toilet, shower or tub.",
      "Never add more than 2 bars.",
    ],
  },
  RAISED_TOILET: {
    quantity: "1 — replace the existing toilet only.",
    placement: "Exactly where the existing toilet is, on the same floor footprint.",
    mounting:
      "A comfort-height toilet, or a raised seat with side armrests fitted onto the existing toilet bowl.",
    scale: "Seat top 17–19 inches (43–48 cm) above the floor.",
    never: [
      "Never add a second toilet or move the toilet.",
      "Never change the vanity, tub, shower or other fixtures.",
    ],
  },
  WALK_IN_SHOWER: {
    quantity: "1 — convert the existing tub or shower only.",
    placement: "Within the footprint of the existing tub or shower alcove.",
    mounting:
      "Curbless or very low-threshold entry, a clear glass panel or shower curtain, and a handheld shower head on a wall slide bar.",
    scale: "Same width and depth as the existing tub or shower alcove.",
    never: [
      "Never extend the shower beyond the existing alcove.",
      "Never add a shower to a room that has no existing tub or shower.",
      "Never change the toilet, vanity or flooring outside the shower.",
    ],
  },
  WIDENED_DOORWAY: {
    quantity: "1 — the main existing doorway visible in the photo.",
    placement: "The existing doorway opening only, widened in place.",
    mounting:
      "Opening widened evenly, with door trim and casing matching the existing style; a wider door or an open doorway.",
    scale: "About 36 inches (91 cm) of clear opening width; height unchanged.",
    never: [
      "Never create a new doorway in a wall that has none.",
      "Never change walls, windows or furniture beyond the doorway itself.",
    ],
  },
  STAIR_LIFT: {
    quantity: "1 stair lift.",
    placement: "Along the existing staircase only, on the inner side next to the wall or banister.",
    mounting:
      "A slim rail fastened to the stair treads running the full length of the flight, with a padded chair and folded footrest parked at the bottom or top landing.",
    scale: "Chair about 2 feet (60 cm) wide; rail follows the stair slope exactly.",
    never: [
      "Never place a stair lift on a wall, floor or area without stairs.",
      "Never show it floating or detached from the stairs.",
      "Never remove the existing banister or railing.",
    ],
  },
  HANDRAILS: {
    quantity: "1–2 rails — one per side of the existing stairs or steps.",
    placement: "Along existing stairs or entry steps only, following their slope.",
    mounting:
      "Continuous rail on wall brackets or posts, 34–38 inches (86–97 cm) above the stair nosing, extending about 12 inches past the top and bottom steps.",
    scale: "Round grip about 1.25–2 inches in diameter, in wood or metal matching the surroundings.",
    never: [
      "Never place handrails on walls or areas without stairs or steps.",
      "Never run handrails across doorways or onto furniture.",
      "Never add more than one rail per side.",
    ],
  },
  RAMP: {
    quantity: "1 small threshold ramp.",
    placement: "At an existing door threshold or single raised step only.",
    mounting: "A wedge-shaped ramp sitting on the floor, flush against the threshold edge.",
    scale:
      "Rise matches the threshold height (typically 1–6 inches); width matches the door opening; no more than about 3 feet long.",
    never: [
      "Never add a long, multi-section ramp or ramp railings.",
      "Never place the ramp in the middle of a room or away from a threshold.",
    ],
  },
  WHEELCHAIR_RAMP: {
    quantity: "1 ramp.",
    placement: "At the existing entry steps or porch, leading from the entry door landing down to the ground.",
    mounting:
      "Sloped ramp at about a 1:12 slope, with handrails on both sides and a level landing at the top by the door.",
    scale: "36–48 inches (91–122 cm) wide; roughly 1 foot of length for every inch of rise.",
    never: [
      "Never place the ramp inside a living space.",
      "Never block doors or windows with the ramp.",
      "Never change the house siding, roof, windows or landscaping beyond the ramp's path.",
    ],
  },
  WALK_IN_TUB: {
    quantity: "1 — replace the existing bathtub only.",
    placement: "Exactly in the footprint of the existing bathtub.",
    mounting: "A walk-in tub with a hinged side door and a built-in seat, set against the same walls.",
    scale: "Same length as the existing tub, with taller sides (about 38–40 inches high).",
    never: [
      "Never add a tub to a room that has no existing bathtub.",
      "Never move the tub or change tile and fixtures beyond the tub itself.",
    ],
  },
  NON_SLIP_FLOORING: {
    quantity: "Replace the visible floor surface only.",
    placement: "The existing floor area, edge to edge.",
    mounting: "Matte, slightly textured slip-resistant tile or vinyl, laid flat and level.",
    scale: "Covers exactly the existing floor area; color close to the original floor.",
    never: [
      "Never change walls, fixtures or furniture.",
      "Never add rugs, mats or raised edges.",
    ],
  },
};

export function getModificationPlacementRule(code: string): ModificationPlacementRule | undefined {
  return MODIFICATION_PLACEMENT_RULES[code as ModificationCode];
}
