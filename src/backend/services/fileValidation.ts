/**
 * File scan validation service.
 * Ensures documents and photos have passed virus scanning before use in the application.
 */

import { prisma } from "lib/prisma";

export async function validateDocumentForUse(documentId: string): Promise<{
  isValid: boolean;
  reason?: string;
}> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    return { isValid: false, reason: "Document not found" };
  }

  if (document.virusScanStatus === "pending") {
    return {
      isValid: false,
      reason: "Document is still undergoing security scan. Please wait and try again shortly.",
    };
  }

  if (document.virusScanStatus === "infected") {
    return {
      isValid: false,
      reason: "Document was rejected due to malware detection and cannot be used.",
    };
  }

  if (document.virusScanStatus === "failed") {
    return {
      isValid: false,
      reason: "Document scan failed. Please re-upload the document.",
    };
  }

  if (document.virusScanStatus !== "clean") {
    return {
      isValid: false,
      reason: "Document has not passed security validation.",
    };
  }

  return { isValid: true };
}

export async function validatePhotoForUse(photoId: string): Promise<{
  isValid: boolean;
  reason?: string;
}> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
  });

  if (!photo) {
    return { isValid: false, reason: "Photo not found" };
  }

  if (photo.virus_scan_status === "pending") {
    return {
      isValid: false,
      reason: "Photo is still undergoing security scan. Please wait and try again shortly.",
    };
  }

  if (photo.virus_scan_status === "infected") {
    return {
      isValid: false,
      reason: "Photo was rejected due to malware detection and cannot be used.",
    };
  }

  if (photo.virus_scan_status === "failed") {
    return {
      isValid: false,
      reason: "Photo scan failed. Please re-upload the photo.",
    };
  }

  if (photo.virus_scan_status !== "clean") {
    return {
      isValid: false,
      reason: "Photo has not passed security validation.",
    };
  }

  return { isValid: true };
}

export async function validateAllProjectDocumentsForSubmission(
  projectId: string
): Promise<{ isValid: boolean; invalidDocuments: string[] }> {
  const documents = await prisma.document.findMany({
    where: { projectId },
  });

  const invalidDocuments = documents
    .filter((doc) => doc.virusScanStatus !== "clean")
    .map((doc) => doc.id);

  return {
    isValid: invalidDocuments.length === 0,
    invalidDocuments,
  };
}

export async function validateAllProjectPhotosForSubmission(
  projectId: string
): Promise<{ isValid: boolean; invalidPhotos: string[] }> {
  const photos = await prisma.photo.findMany({
    where: { projectId },
  });

  const invalidPhotos = photos
    .filter((photo) => photo.virus_scan_status !== "clean")
    .map((photo) => photo.id);

  return {
    isValid: invalidPhotos.length === 0,
    invalidPhotos,
  };
}
