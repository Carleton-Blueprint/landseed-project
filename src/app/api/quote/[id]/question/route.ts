/**
 * API route: POST /api/quote/[id]/question — submit a question about an estimate.
 * Allows clients to request clarifications or modifications from the Advisory Team.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";

const VALID_CATEGORIES = [
  "PRICING",
  "SCOPE",
  "TIMELINE",
  "MATERIALS",
  "GRANT_ELIGIBILITY",
  "MODIFICATION_REQUEST",
  "GENERAL",
] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestContext = getRequestAuditContext(req);
  const { id: quoteId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { category, subject, message } = body;

    // Validate inputs
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: "Invalid or missing question category" },
        { status: 400 }
      );
    }

    if (!subject || typeof subject !== "string" || subject.trim().length < 3) {
      return NextResponse.json(
        { error: "Subject is required (minimum 3 characters)" },
        { status: 400 }
      );
    }

    if (!message || typeof message !== "string" || message.trim().length < 10) {
      return NextResponse.json(
        { error: "Message is required (minimum 10 characters)" },
        { status: 400 }
      );
    }

    if (message.length > 2000) {
      return NextResponse.json(
        { error: "Message is too long (maximum 2000 characters)" },
        { status: 400 }
      );
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
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "QUOTE_QUESTION_SUBMIT",
        outcome: "DENIED",
        sensitivityLevel: "CONFIDENTIAL",
        actorUserId: session.user.id,
        projectId: quote.projectId,
        quoteId: quote.id,
        resourceType: "quote_question",
        description: "Question submission denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json(
        { error: "You don't have access to this estimate" },
        { status: 403 }
      );
    }

    // Create the question and refresh the inactivity clock together.
    const question = await prisma.$transaction(async (tx) => {
      const createdQuestion = await tx.quoteQuestion.create({
        data: {
          quoteId,
          category: category as (typeof VALID_CATEGORIES)[number],
          subject: subject.trim(),
          message: message.trim(),
          askedByUserId: session.user.id,
        },
      });

      await tx.quote.update({
        where: { id: quote.id },
        data: { lastClientActivityAt: new Date() },
      });

      return createdQuestion;
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "QUOTE_QUESTION_SUBMIT",
      outcome: "SUCCESS",
      sensitivityLevel: "CONFIDENTIAL",
      actorUserId: session.user.id,
      projectId: quote.projectId,
      quoteId: quote.id,
      resourceType: "quote_question",
      resourceId: question.id,
      description: `Client submitted question about estimate: ${category}`,
      metadata: {
        questionCategory: category,
        subject: subject.trim(),
      },
      ...requestContext,
    });

    // Trigger internal notification for Advisory Team
    const advisoryTeamEmailsEnv = process.env.ADVISORY_TEAM_EMAILS || "";
    const advisoryTeamEmails = advisoryTeamEmailsEnv
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0);

    if (advisoryTeamEmails.length > 0) {
      try {
        const { enqueueQuestionNotificationForAdvisoryTeam } = 
          await import("@/backend/notifications/questionNotificationContract");
        
        await enqueueQuestionNotificationForAdvisoryTeam({
          quoteId: quote.id,
          projectId: quote.projectId,
          projectAddress: quote.project.address,
          questionCategory: category,
          questionSubject: subject.trim(),
          questionId: question.id,
          clientName: (session.user as any).name,
          clientEmail: session.user.email,
          advisoryTeamEmails,
        });
      } catch (notificationError) {
        console.error("Failed to enqueue advisory team notification:", notificationError);
        
        await logAuditEventNonBlocking({
          category: "MANUAL_CHANGE",
          action: "QUESTION_ADVISORY_NOTIFICATION_FAILED",
          outcome: "FAILURE",
          sensitivityLevel: "CONFIDENTIAL",
          actorUserId: session.user.id,
          projectId: quote.projectId,
          quoteId: quote.id,
          resourceType: "quote_question",
          resourceId: question.id,
          description: "Failed to enqueue advisory team notification for question",
          metadata: {
            errorMessage: 
              notificationError instanceof Error 
                ? notificationError.message 
                : "Unknown error",
          },
          ...requestContext,
        });
      }
    }

    return NextResponse.json({
      success: true,
      question: {
        id: question.id,
        category: question.category,
        subject: question.subject,
        message: question.message,
        status: question.status,
        createdAt: question.createdAt,
      },
    });
  } catch (error) {
    console.error("Question submission error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
