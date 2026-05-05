"use client";

import React, { useState } from "react";
import Link from "next/link";

// Type matches Prisma result with flag + project relationships
export interface FlaggedProject {
  id: string;
  projectId: string;
  reason: "LOW_CONFIDENCE" | "HIGH_COMPLEXITY" | "BOTH";
  isActive: boolean;
  lastEvaluatedAt: Date;
  lastEvaluationEligibilityAssessmentId: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  project: {
    id: string;
    name: string;
    createdAt: Date;
    user: {
      id: string;
      name: string | null;
      email: string | null;
    };
    _count: {
      eligibilityAssessments: number;
      quotes: number;
    };
  };
}

interface FlaggedProjectsClientProps {
  flaggedProjects: FlaggedProject[];
}

// Tailwind classes for reason badges
const reasonBadgeColor: Record<string, string> = {
  LOW_CONFIDENCE:
    "bg-yellow-100 text-yellow-800 border border-yellow-300",
  HIGH_COMPLEXITY:
    "bg-orange-100 text-orange-800 border border-orange-300",
  BOTH: "bg-red-100 text-red-800 border border-red-300",
};

const reasonLabel: Record<string, string> = {
  LOW_CONFIDENCE: "Low Confidence",
  HIGH_COMPLEXITY: "High Complexity",
  BOTH: "Low Confidence + High Complexity",
};

export function FlaggedProjectsClient({
  flaggedProjects,
}: FlaggedProjectsClientProps) {
  const [sortBy, setSortBy] = useState<"flaggedDate" | "projectName">(
    "flaggedDate"
  );
  const [filterReason, setFilterReason] = useState<string | "ALL">("ALL");

  const filtered =
    filterReason === "ALL"
      ? flaggedProjects
      : flaggedProjects.filter((fp) => fp.reason === filterReason);

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "flaggedDate") {
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else {
      return a.project.name.localeCompare(b.project.name);
    }
  });

  if (sorted.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">
          {filterReason === "ALL"
            ? "No flagged projects found."
            : `No projects flagged for "${reasonLabel[filterReason]}".`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Filter by Reason:
            </label>
            <select
              value={filterReason}
              onChange={(e) => setFilterReason(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium"
            >
              <option value="ALL">All Reasons</option>
              <option value="LOW_CONFIDENCE">Low Confidence</option>
              <option value="HIGH_COMPLEXITY">High Complexity</option>
              <option value="BOTH">Both</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sort by:
            </label>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "flaggedDate" | "projectName")
              }
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium"
            >
              <option value="flaggedDate">Flagged Date (Newest)</option>
              <option value="projectName">Project Name (A-Z)</option>
            </select>
          </div>
        </div>

        <div className="text-sm text-gray-600">
          Showing {sorted.length} of {flaggedProjects.length} flagged projects
        </div>
      </div>

      <div className="grid gap-4">
        {sorted.map((flaggedProject) => (
          <div
            key={flaggedProject.id}
            className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6"
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">
                      {flaggedProject.project.name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      ID: {flaggedProject.project.id}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                      reasonBadgeColor[flaggedProject.reason]
                    }`}
                  >
                    {reasonLabel[flaggedProject.reason]}
                  </span>
                </div>

                <div className="mt-3 text-sm text-gray-600">
                  <p>
                    <strong>Client:</strong> {flaggedProject.project.user.name || "Unknown"} ({flaggedProject.project.user.email})
                  </p>
                  <p>
                    <strong>Project Created:</strong>{" "}
                    {new Date(flaggedProject.project.createdAt).toLocaleDateString()}
                  </p>
                  <p>
                    <strong>Flagged:</strong>{" "}
                    {new Date(flaggedProject.createdAt).toLocaleDateString()}
                  </p>
                  <p>
                    <strong>Last Evaluated:</strong>{" "}
                    {new Date(flaggedProject.lastEvaluatedAt).toLocaleDateString()}
                  </p>
                </div>

                {flaggedProject.description && (
                  <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200">
                    <p className="text-sm text-gray-700">
                      <strong>Reason:</strong> {flaggedProject.description}
                    </p>
                  </div>
                )}

                <div className="mt-3 flex gap-4 text-sm text-gray-600">
                  <span>
                    <strong>{flaggedProject.project._count.eligibilityAssessments}</strong> Assessments
                  </span>
                  <span>
                    <strong>{flaggedProject.project._count.quotes}</strong> Quotes
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 md:flex-col md:items-end">
                <Link
                  href={`/admin/projects/${flaggedProject.project.id}`}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  View Project
                </Link>
                <Link
                  href={`/dashboard/projects/${flaggedProject.project.id}`}
                  className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-900 rounded-md hover:bg-gray-300 transition-colors text-sm font-medium"
                >
                  Review Assessment
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
