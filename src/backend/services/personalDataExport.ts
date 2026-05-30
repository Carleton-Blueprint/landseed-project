import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "lib/prisma";
import * as fs from "fs";

export interface PersonalDataPayload {
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
  };
  projects: Array<{
    id: string;
    address: string;
    status: string;
    createdAt: string;
  }>;
  accessRecords: Array<{
    projectId: string;
    projectAddress: string;
    collaboratorName: string | null;
    collaboratorEmail: string;
    role: string;
    grantedAt: string;
  }>;
}

const MOCK_DB_FILE = "/Users/diandrainturire/Desktop/landseed-project-main/previews/profile_db.json";

function readMockProfile(defaultUser: { id: string; name: string; email: string; phone: string }) {
  if (fs.existsSync(MOCK_DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MOCK_DB_FILE, "utf-8"));
      return {
        id: defaultUser.id,
        name: data.name || defaultUser.name,
        email: data.email || defaultUser.email,
        phone: data.phone || defaultUser.phone,
      };
    } catch {
      // ignore
    }
  }
  return defaultUser;
}

/**
 * Gather all personal data and project history for a user.
 * Bypasses database errors in development mode to return high-fidelity mock data.
 */
export async function gatherPersonalData(userId: string, userEmail: string, userName?: string | null): Promise<PersonalDataPayload> {
  try {
    const userProfile = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    });

    if (!userProfile) {
      throw new Error("User profile not found in database");
    }

    const projects = await prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, address: true, status: true, createdAt: true },
    });

    const projectIds = projects.map((p) => p.id);

    const accessRecordsRaw = await prisma.projectAccess.findMany({
      where: {
        projectId: { in: projectIds },
        userId: { not: userId }, // Exclude self
      },
      include: {
        project: { select: { address: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const accessRecords = accessRecordsRaw.map((rec) => ({
      projectId: rec.projectId,
      projectAddress: rec.project.address,
      collaboratorName: rec.user.name,
      collaboratorEmail: rec.user.email,
      role: rec.role,
      grantedAt: rec.createdAt.toISOString(),
    }));

    return {
      user: {
        id: userProfile.id,
        name: userProfile.name,
        email: userProfile.email,
        phone: userProfile.phone,
      },
      projects: projects.map((p) => ({
        id: p.id,
        address: p.address,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      accessRecords,
    };
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      const mockProfile = readMockProfile({
        id: userId,
        name: userName || "Dev User",
        email: userEmail,
        phone: "(555) 019-2834",
      });

      // High-fidelity development fallback dataset
      return {
        user: mockProfile,
        projects: [
          {
            id: "dev-project-1",
            address: "123 Dev Lane, Mockville",
            status: "estimate_ready",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
          },
          {
            id: "dev-project-2",
            address: "456 Access Way, Cityville",
            status: "submitted",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
          }
        ],
        accessRecords: [
          {
            projectId: "dev-project-1",
            projectAddress: "123 Dev Lane, Mockville",
            collaboratorName: "Sarah Connor (Caregiver)",
            collaboratorEmail: "sarah.c@caregivers.com",
            role: "EDITOR",
            grantedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
          },
          {
            projectId: "dev-project-1",
            projectAddress: "123 Dev Lane, Mockville",
            collaboratorName: "John Connor (Son)",
            collaboratorEmail: "john.c@family.com",
            role: "VIEWER",
            grantedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
          }
        ],
      };
    }
    throw error;
  }
}

/**
 * Format string utility for CSV representation, escaping quotes and commas.
 */
function escapeCsv(val: string | null | undefined): string {
  if (val == null) return '""';
  const str = String(val).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate personal data as an RFC 4180-compliant CSV string.
 */
export function generatePersonalDataCsv(data: PersonalDataPayload): string {
  const lines: string[] = [];

  // Section 1: User Profile Details
  lines.push("=== USER PROFILE INFORMATION ===");
  lines.push("User ID,Full Name,Email Address,Phone Number");
  lines.push([
    escapeCsv(data.user.id),
    escapeCsv(data.user.name),
    escapeCsv(data.user.email),
    escapeCsv(data.user.phone)
  ].join(","));
  lines.push("");

  // Section 2: Active Projects
  lines.push("=== HOME MODIFICATION PROJECTS ===");
  lines.push("Project ID,Street Address,Current Status,Date Created");
  if (data.projects.length === 0) {
    lines.push("No active projects found.,,,");
  } else {
    for (const p of data.projects) {
      lines.push([
        escapeCsv(p.id),
        escapeCsv(p.address),
        escapeCsv(p.status),
        escapeCsv(p.createdAt)
      ].join(","));
    }
  }
  lines.push("");

  // Section 3: Shared Access & Collaborators
  lines.push("=== CARE AND ACCESS PERMISSIONS ===");
  lines.push("Project ID,Project Address,Collaborator Name,Collaborator Email,Assigned Role,Date Granted");
  if (data.accessRecords.length === 0) {
    lines.push("No care or access permissions configured.,,,,,");
  } else {
    for (const r of data.accessRecords) {
      lines.push([
        escapeCsv(r.projectId),
        escapeCsv(r.projectAddress),
        escapeCsv(r.collaboratorName),
        escapeCsv(r.collaboratorEmail),
        escapeCsv(r.role),
        escapeCsv(r.grantedAt)
      ].join(","));
    }
  }

  return lines.join("\r\n");
}

/**
 * Helper to wrap long strings to a specified character width.
 */
function wrapText(text: string, limit: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + word).length <= limit) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Generate personal data as a highly professional, beautifully styled PDF document.
 */
export async function generatePersonalDataPdf(data: PersonalDataPayload): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const marginX = 50;
  let y = 742;
  const lineGap = 16;

  // 1. Header (Emerald and dark blue styling matching Landseed design system)
  page.drawText("LANDSEED", {
    x: marginX,
    y,
    size: 24,
    font: fontBold,
    color: rgb(0.06, 0.48, 0.35), // Emerald primary brand color
  });
  
  page.drawText("PERSONAL DATA EXPORT REPORT", {
    x: marginX,
    y: y - 22,
    size: 11,
    font: fontBold,
    color: rgb(0.3, 0.35, 0.45),
  });

  // Top Divider Bar
  y -= 32;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: 562, y },
    thickness: 1.5,
    color: rgb(0.9, 0.9, 0.9),
  });

  // Explanation/Disclaimer text
  y -= 22;
  const disclaimer = wrapText(
    "In accordance with modern privacy standards, this report contains all personal information, project records, and caregivers access permissions linked to your profile.",
    75
  );
  for (const line of disclaimer) {
    page.drawText(line, {
      x: marginX,
      y,
      size: 9.5,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.5),
    });
    y -= 13;
  }

  y -= 15;

  // 2. Section: Profile Details
  page.drawText("1. Profile Information", {
    x: marginX,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.25),
  });
  
  y -= 18;
  const profileFields: Array<[string, string | null]> = [
    ["User ID", data.user.id],
    ["Full Name", data.user.name || "N/A"],
    ["Email Address", data.user.email],
    ["Phone Number", data.user.phone || "N/A"],
  ];

  for (const [lbl, val] of profileFields) {
    page.drawText(`${lbl}:`, { x: marginX + 10, y, size: 10, font: fontBold, color: rgb(0.2, 0.25, 0.3) });
    page.drawText(val || "N/A", { x: marginX + 150, y, size: 10, font: fontRegular, color: rgb(0.08, 0.08, 0.08) });
    y -= lineGap;
  }

  y -= 15;

  // 3. Section: Home Modification Projects
  page.drawText("2. Home Modification Projects", {
    x: marginX,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 18;
  if (data.projects.length === 0) {
    page.drawText("No active projects are currently linked to your account.", {
      x: marginX + 10,
      y,
      size: 10,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
    });
    y -= lineGap;
  } else {
    for (const p of data.projects) {
      // Check for spacing overflow
      if (y < 80) break; // simplistic single page guard (fits average 2-4 items comfortably)
      
      page.drawText(`Project: ${p.address}`, {
        x: marginX + 10,
        y,
        size: 10.5,
        font: fontBold,
        color: rgb(0.06, 0.48, 0.35),
      });
      y -= 14;
      
      const createdDate = new Date(p.createdAt).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      page.drawText(`Status: ${p.status.toUpperCase()}  ·  Created: ${createdDate}  ·  ID: ${p.id}`, {
        x: marginX + 26,
        y,
        size: 9,
        font: fontRegular,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 22;
    }
  }

  y -= 10;

  // 4. Section: Caregiver Access Permissions
  page.drawText("3. Caregiver & Access Permissions", {
    x: marginX,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  y -= 18;
  if (data.accessRecords.length === 0) {
    page.drawText("No external caregivers or family members have access to your projects.", {
      x: marginX + 10,
      y,
      size: 10,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
    });
    y -= lineGap;
  } else {
    for (const r of data.accessRecords) {
      if (y < 80) break;
      
      page.drawText(`Collaborator: ${r.collaboratorName || "Collaborator"} (${r.collaboratorEmail})`, {
        x: marginX + 10,
        y,
        size: 10.5,
        font: fontBold,
        color: rgb(0.1, 0.15, 0.25),
      });
      y -= 14;

      const grantedDate = new Date(r.grantedAt).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      page.drawText(`Role: ${r.role}  ·  Granted: ${grantedDate}  ·  Project: ${r.projectAddress}`, {
        x: marginX + 26,
        y,
        size: 9,
        font: fontRegular,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 22;
    }
  }

  // Footer bar
  page.drawLine({
    start: { x: marginX, y: 50 },
    end: { x: 562, y: 50 },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });

  page.drawText("Landseed Demo Project Client Portal Data Export. End of Report.", {
    x: marginX,
    y: 36,
    size: 8,
    font: fontRegular,
    color: rgb(0.6, 0.6, 0.6),
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
