import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  gatherPersonalData,
  generatePersonalDataCsv,
  generatePersonalDataPdf,
} from "@/backend/services/personalDataExport";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ format: string }> }
) {
  const requestContext = getRequestAuditContext(request);
  const { format } = await params;

  try {
    const session = await auth();

    // 1. Authenticate user session
    if (!session?.user?.id || !session?.user?.email) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "CLIENT_PERSONAL_DATA_EXPORT",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        description: "Unauthenticated personal data export request attempt",
        ...requestContext,
      });

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const userEmail = session.user.email;
    const userName = session.user.name ?? "Dev User";

    const exportFormat = format.toLowerCase();

    // 2. Validate requested file format
    if (exportFormat !== "pdf" && exportFormat !== "csv") {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "CLIENT_PERSONAL_DATA_EXPORT",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: userId,
        description: `Failed personal data export: invalid format requested (${format})`,
        ...requestContext,
      });

      return NextResponse.json(
        { error: "Invalid export format. Only PDF and CSV are supported." },
        { status: 400 }
      );
    }

    // 3. Gather data (dev-safe fallbacks included)
    const personalData = await gatherPersonalData(userId, userEmail, userName);

    // 4. Generate file content based on format
    if (exportFormat === "pdf") {
      const pdfBuffer = await generatePersonalDataPdf(personalData);

      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "CLIENT_PERSONAL_DATA_EXPORT",
        outcome: "SUCCESS",
        sensitivityLevel: "RESTRICTED",
        actorUserId: userId,
        description: "Client successfully exported personal data in PDF format",
        ...requestContext,
      });

      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "attachment; filename=personal_data_export.pdf",
          "Cache-Control": "no-store, must-revalidate",
        },
      });
    } else {
      const csvString = generatePersonalDataCsv(personalData);
      const csvBuffer = Buffer.from(csvString, "utf-8");

      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "CLIENT_PERSONAL_DATA_EXPORT",
        outcome: "SUCCESS",
        sensitivityLevel: "RESTRICTED",
        actorUserId: userId,
        description: "Client successfully exported personal data in CSV format",
        ...requestContext,
      });

      return new NextResponse(csvBuffer, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=personal_data_export.csv",
          "Cache-Control": "no-store, must-revalidate",
        },
      });
    }
  } catch (error) {
    console.error("Personal data export API error:", error);

    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "CLIENT_PERSONAL_DATA_EXPORT",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      description: "Internal error occurred during personal data export",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown export error",
      },
      ...requestContext,
    });

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
