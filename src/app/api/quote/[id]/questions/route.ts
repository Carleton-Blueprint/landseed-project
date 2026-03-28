/**
 * API route: GET /api/quote/[id]/questions — lists all questions for a quote.
 * Requires authentication and project access.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: quoteId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify quote exists and user has access
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        project: {
          include: {
            projectAccess: {
              where: { userId: session.user.id },
            },
          },
        },
      },
    });

    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (quote.project.projectAccess.length === 0) {
      return NextResponse.json(
        { error: "You don't have access to this estimate" },
        { status: 403 }
      );
    }

    const questions = await prisma.quoteQuestion.findMany({
      where: { quoteId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        category: true,
        subject: true,
        message: true,
        status: true,
        response: true,
        respondedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("Error listing questions:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
