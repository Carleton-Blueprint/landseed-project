import { prisma } from 'lib/prisma';
import { deriveAddressFromIntakeData } from './intakeDraft';
import type { PromoteIntakeData } from "@/backend/schemas/intakeDraft";

export interface AssembledGrantPdfInput {
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string | null;
  projectAddress: string;
  projectId: string;
  grantProgramName: string;
  modificationItems: string[];
  estimatedCost?: string | null;
  ownershipStatus: string;
  incompleteFields: string[];
  preparedAtIso: string;
}

interface DraftIntakeFields {
  name?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  ownershipStatus?: string;
  modificationItems?: unknown[];
}

interface DiscoveredGrant {
  title?: string;
}

export async function assembleGrantPdfInput(projectId: string): Promise<AssembledGrantPdfInput> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      address: true,
      draftData: true,
      userId: true,
      user: { select: { name: true, email: true, phone: true } },
      quotes: { orderBy: { createdAt: 'desc' }, take: 1, select: { estimateMin: true, estimateMax: true } },
      eligibilityAssessments: { orderBy: { createdAt: 'desc' }, take: 1, select: { overallDecision: true, discoveredGrants: true } },
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const draft = (project.draftData ?? {}) as unknown as DraftIntakeFields;

  const incompleteFields: string[] = [];

  // Applicant name
  const applicantName =
    typeof project.user?.name === 'string' && project.user.name.trim()
      ? project.user.name.trim()
      : typeof draft.name === 'string' && draft.name.trim()
      ? draft.name.trim()
      : '[Incomplete]';
  if (applicantName === '[Incomplete]') incompleteFields.push('client name');

  // Applicant email
  const applicantEmail =
    typeof project.user?.email === 'string' && project.user.email.trim()
      ? project.user.email.trim()
      : typeof draft.email === 'string' && draft.email.trim()
      ? draft.email.trim()
      : '[Incomplete]';
  if (applicantEmail === '[Incomplete]') incompleteFields.push('client email');

  // Applicant phone (optional)
  const applicantPhone =
    typeof project.user?.phone === 'string' && project.user.phone.trim()
      ? project.user.phone.trim()
      : typeof draft.phone === 'string' && draft.phone.trim()
      ? draft.phone.trim()
      : null;
  if (!applicantPhone) incompleteFields.push('client phone');

  // Address: derive from draft intake if available, otherwise project.address
  let projectAddress = project.address ?? '';
  try {
    if (draft.addressLine1 || draft.city || draft.province || draft.postalCode) {
      const addressInput: Pick<PromoteIntakeData, 'addressLine1' | 'city' | 'province' | 'postalCode'> = {
        addressLine1: draft.addressLine1 ?? '',
        city: draft.city ?? '',
        province: (draft.province ?? '') as PromoteIntakeData['province'],
        postalCode: draft.postalCode ?? '',
      };
      projectAddress = deriveAddressFromIntakeData(addressInput);
    }
  } catch {
    // ignore and fall back to project.address
  }
  if (!projectAddress || projectAddress === '') {
    projectAddress = '[Incomplete]';
    incompleteFields.push('project address');
  }

  // Ownership status
  const rawOwnership = draft.ownershipStatus;
  let ownershipStatus = 'Other';
  if (rawOwnership === 'owner' || rawOwnership === 'Owner') ownershipStatus = 'Owner';
  else if (rawOwnership === 'tenant' || rawOwnership === 'Tenant') ownershipStatus = 'Tenant';
  else if (!rawOwnership) {
    ownershipStatus = '[Incomplete]';
    incompleteFields.push('property ownership status');
  }

  // Modification items
  const modificationItemsRaw = Array.isArray(draft.modificationItems)
    ? draft.modificationItems.map((i: unknown) => String(i))
    : [];
  if (modificationItemsRaw.length === 0) incompleteFields.push('modification type');

  // Estimated cost: try latest quote
  let estimatedCost: string | null = null;
  const latestQuote = project.quotes[0];
  if (latestQuote?.estimateMin != null && latestQuote?.estimateMax != null) {
    const min = latestQuote.estimateMin.toNumber();
    const max = latestQuote.estimateMax.toNumber();
    if (!Number.isNaN(min) && !Number.isNaN(max)) {
      estimatedCost = `$${min.toLocaleString()} \u2013 $${max.toLocaleString()}`;
    }
  }
  if (!estimatedCost) {
    incompleteFields.push('estimated cost');
  }

  // Grant program: pick top ELIGIBLE discovered grant title if assessment says ELIGIBLE
  let grantProgramName = 'Landseed Grant Application';
  const assessment = project.eligibilityAssessments[0];
  if (assessment?.overallDecision === 'ELIGIBLE') {
    // discoveredGrants is Json?; route through unknown rather than any.
    const discovered = assessment.discoveredGrants as unknown as DiscoveredGrant[] | null | undefined;
    if (Array.isArray(discovered) && discovered.length > 0 && discovered[0]?.title) {
      grantProgramName = discovered[0].title;
    }
  }

  return {
    applicantName,
    applicantEmail,
    applicantPhone,
    projectAddress,
    projectId: project.id,
    grantProgramName,
    modificationItems: modificationItemsRaw,
    estimatedCost,
    ownershipStatus,
    incompleteFields,
    preparedAtIso: new Date().toISOString(),
  };
}