export type QuoteEstimateLike =
  | {
      estimateMin?: { toString(): string } | number | string | null;
      estimateMax?: { toString(): string } | number | string | null;
    }
  | null
  | undefined;

export function getEstimateRangeFromQuote(quote: QuoteEstimateLike) {
  if (!quote || quote.estimateMin == null || quote.estimateMax == null) {
    return null;
  }

  const min = Number(quote.estimateMin.toString());
  const max = Number(quote.estimateMax.toString());

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}