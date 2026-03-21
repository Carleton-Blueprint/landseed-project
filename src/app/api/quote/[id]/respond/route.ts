import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const body = await req.json();
    const { status, reason } = body;

    // Validate inputs
    if (status !== "ACCEPTED" && status !== "DECLINED") {
      return NextResponse.json({ error: "Invalid status provided" }, { status: 400 });
    }
    if (status === "DECLINED" && (!reason || typeof reason !== "string")) {
      return NextResponse.json({ error: "A valid reason is required when declining" }, { status: 400 });
    }

    // Fetch the quote and its related project access
    const quote = await prisma.quote.findUnique({
      where: { id: resolvedParams.id },
      include: {
        project: {
          include: {
            projectAccess: {
              where: { userId: session.user.id }
            }
          }
        }
      }
    });

    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // Check if the user has access to this project
    if (quote.project.projectAccess.length === 0) {
      return NextResponse.json({ error: "Forbidden: You don't have access to this quote" }, { status: 403 });
    }

    // Process the update
    const updatedProjectStatus = status === "ACCEPTED" ? "estimate_accepted" : "estimate_declined";

    // Update Quote status and Project status in a transaction
    const [updatedQuote] = await prisma.$transaction([
      prisma.quote.update({
        where: { id: quote.id },
        data: {
          status: status,
          declinedReason: status === "DECLINED" ? reason : null,
        }
      }),
      prisma.project.update({
        where: { id: quote.projectId },
        data: {
          status: updatedProjectStatus,
          // Optional: we can store structured decline data in project draftData too
        }
      })
    ]);

    return NextResponse.json({ success: true, quote: updatedQuote }, { status: 200 });
  } catch (error: any) {
    console.error("Quote response error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
