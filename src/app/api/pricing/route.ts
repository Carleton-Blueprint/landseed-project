import { getMaterialPrice } from "@/backend/services/pricing";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query || query.trim().length === 0) {
    return Response.json({ error: "Missing query" }, { status: 400 });
  }

  try {
    const result = await getMaterialPrice(query);
    return Response.json(result);
  } catch {
    return Response.json(
      { error: "Failed to fetch pricing" },
      { status: 500 }
    );
  }
}
