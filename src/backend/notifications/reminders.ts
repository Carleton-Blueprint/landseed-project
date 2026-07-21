import { prisma } from "lib/prisma";
import { NotificationItem } from "@/frontend/components/NotificationCenter";
import { QuoteStatus } from "@prisma/client";

/**
 * Checks for any pending administrative action items (where eligibility is in NEEDS_MORE_INFO)
 * that have not been responded to for over 7 days.
 * Returns a list of urgent reminder notifications.
 */
export async function get7DayRemindersForUser(userId: string): Promise<NotificationItem[]> {
  try {
    // 1. Get all projects where this user has access, including photos and documents.
    const projects = await prisma.project.findMany({
      where: {
        projectAccess: {
          some: { userId },
        },
      },
      include: {
        photos: {
          orderBy: { createdAt: "desc" },
        },
        documents: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    const reminders: NotificationItem[] = [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const project of projects) {
      // 2. Retrieve the latest eligibility assessment for the project
      const latestAssessment = await prisma.eligibilityAssessment.findFirst({
        where: {
          projectId: project.id,
          isLatest: true,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!latestAssessment || latestAssessment.overallDecision !== "NEEDS_MORE_INFO") {
        continue;
      }

      const requestDate = new Date(latestAssessment.createdAt);
      if (requestDate > sevenDaysAgo) {
        // Assessment request is newer than 7 days
        continue;
      }

      // 3. Determine what is requested based on missingRequirements
      let missingReqs: string[] = [];
      try {
        const rawReqs = latestAssessment.missingRequirements;
        if (typeof rawReqs === "string") {
          const parsed = JSON.parse(rawReqs);
          if (Array.isArray(parsed)) {
            missingReqs = parsed.map(String);
          } else if (parsed && typeof parsed === "object") {
            missingReqs = Object.keys(parsed).map(String);
          }
        } else if (Array.isArray(rawReqs)) {
          missingReqs = rawReqs.map(String);
        } else if (rawReqs && typeof rawReqs === "object") {
          missingReqs = Object.keys(rawReqs).map(String);
        }
      } catch (err) {
        console.warn("Failed to parse missingRequirements for project:", project.id, err);
      }

      const needsPhotos = missingReqs.some((r) => r.toLowerCase().includes("photo"));
      const needsDocs = missingReqs.some(
        (r) =>
          r.toLowerCase().includes("doc") ||
          r.toLowerCase().includes("proof") ||
          r.toLowerCase().includes("id") ||
          r.toLowerCase().includes("tax") ||
          r.toLowerCase().includes("certificate") ||
          r.toLowerCase().includes("ownership") ||
          r.toLowerCase().includes("income")
      );
      const needsGeneral = missingReqs.length > 0 && !needsPhotos && !needsDocs;

      // 4. Check if the user has responded since the requestDate.
      // A response is defined as uploading a photo or document after the request date.
      const hasNewPhotos = project.photos.some((p) => new Date(p.createdAt) > requestDate);
      const hasNewDocs = project.documents.some((d) => new Date(d.createdAt) > requestDate);

      let isCompleted = false;
      if (needsPhotos && needsDocs) {
        isCompleted = hasNewPhotos && hasNewDocs;
      } else if (needsPhotos) {
        isCompleted = hasNewPhotos;
      } else if (needsDocs) {
        isCompleted = hasNewDocs;
      } else if (needsGeneral) {
        isCompleted = hasNewPhotos || hasNewDocs;
      } else {
        // Fallback: if any uploads exist after request date, assume completed
        isCompleted = hasNewPhotos || hasNewDocs;
      }

      if (isCompleted) {
        continue;
      }

      // 5. Generate formatted string for the notification body
      const formattedDate = requestDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      let title = "Pending action required";
      let body = `Additional information requested by the advisory team on ${formattedDate}`;

      if (needsPhotos) {
        title = "Additional photos requested";
        body = `Additional photos requested by the advisory team on ${formattedDate}`;
      } else if (needsDocs) {
        title = "Supporting documents requested";
        body = `Supporting documents requested by the advisory team on ${formattedDate}`;
      }

      reminders.push({
        id: `reminder-7d-${project.id}-${latestAssessment.id}`,
        kind: "action_required",
        title,
        body,
        href: `/dashboard/${project.id}`,
        createdAt: requestDate.toISOString(),
        urgent: true,
        read: false,
      });
    }

    return reminders;
  } catch (error) {
    console.error("Error in get7DayRemindersForUser:", error);
    return [];
  }
}

/**
 * Checks for any refined estimates that have been PENDING and inactive for 14 or more days
 * (but less than 30 days, when they expire).
 * Returns a list of urgent reminder notifications.
 */
export async function get14DayEstimateRemindersForUser(userId: string): Promise<NotificationItem[]> {
  try {
    const projects = await prisma.project.findMany({
      where: {
        projectAccess: {
          some: { userId },
        },
      },
      include: {
        quotes: {
          where: {
            status: QuoteStatus.PENDING,
          },
          orderBy: { generatedAt: "desc" },
        },
      },
    });

    const reminders: NotificationItem[] = [];
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    for (const project of projects) {
      const pendingQuote = project.quotes[0]; // Latest pending quote
      if (!pendingQuote || pendingQuote.status !== QuoteStatus.PENDING) {
        continue;
      }

      const inactivityDate = new Date(pendingQuote.lastClientActivityAt);

      // Must be inactive for >= 14 days and < 30 days (not yet expired)
      if (inactivityDate <= fourteenDaysAgo && inactivityDate > thirtyDaysAgo) {
        const deliveredDate = new Date(pendingQuote.generatedAt);
        const formattedDeliveredDate = deliveredDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });

        reminders.push({
          id: `reminder-14d-estimate-${pendingQuote.id}`,
          kind: "action_required",
          title: "Estimate Expiring Soon",
          body: `Refined Estimate for ${project.address}, delivered on ${formattedDeliveredDate}, will expire after 30 days of inactivity.`,
          href: `/projects/${project.id}/estimate`,
          createdAt: inactivityDate.toISOString(),
          urgent: true,
          read: false,
        });
      }
    }

    return reminders;
  } catch (error) {
    console.error("Error in get14DayEstimateRemindersForUser:", error);
    return [];
  }
}

/**
 * Combined function to get all active dashboard reminders.
 */
export async function getDashboardReminders(userId: string): Promise<NotificationItem[]> {
  const [actionReminders, estimateReminders] = await Promise.all([
    get7DayRemindersForUser(userId),
    get14DayEstimateRemindersForUser(userId),
  ]);
  return [...actionReminders, ...estimateReminders];
}
