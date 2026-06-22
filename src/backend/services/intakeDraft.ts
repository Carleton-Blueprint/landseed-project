import { Prisma } from "@prisma/client";
import { prisma } from "lib/prisma";
import type { GuidedData, IntakeData } from "@/backend/schemas/intakeDraft";

export interface MergeIntakeDraftInput {
  guidedData?: GuidedData;
  intakeData?: IntakeData;
}

export async function getIntakeDraft(userId: string) {
  return prisma.intakeDraft.findUnique({
    where: { userId },
  });
}

export async function getOrCreateIntakeDraft(userId: string) {
  return prisma.intakeDraft.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function mergeIntakeDraft(userId: string, input: MergeIntakeDraftInput) {
  await getOrCreateIntakeDraft(userId);

  const data: Prisma.IntakeDraftUpdateInput = {};

  if (input.guidedData !== undefined) {
    data.guidedData = input.guidedData as Prisma.InputJsonValue;
  }

  if (input.intakeData !== undefined) {
    data.intakeData = input.intakeData as Prisma.InputJsonValue;
  }

  return prisma.intakeDraft.update({
    where: { userId },
    data,
  });
}
