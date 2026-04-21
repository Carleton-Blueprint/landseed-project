"use client";

import React, { useState } from "react";

type QuoteStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";

interface EstimateClientProps {
  quoteId: string;
  initialStatus: QuoteStatus;
  initialReason: string | null;
}

export function EstimateClientComponent({ quoteId, initialStatus, initialReason }: EstimateClientProps) {
  const [status, setStatus] = useState<QuoteStatus>(initialStatus);
  const [declineReason, setDeclineReason] = useState<string>(initialReason || "");
  const [customReason, setCustomReason] = useState<string>("");
  const [isDeclining, setIsDeclining] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResponse = async (newStatus: QuoteStatus) => {
    setIsSubmitting(true);
    setError(null);

    const reasonPayload = newStatus === "DECLINED" ? (declineReason === "Other" ? customReason : declineReason) : null;

    if (newStatus === "DECLINED" && (!reasonPayload || reasonPayload.trim() === "")) {
      setError("Please select or enter a reason for declining.");
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/quote/${quoteId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, reason: reasonPayload }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit response");
      }

      setStatus(newStatus);
      if (newStatus === "DECLINED") {
         setDeclineReason(reasonPayload!);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReactivate = async () => {
    setIsReactivating(true);
    setError(null);

    try {
      const res = await fetch(`/api/quote/${quoteId}/reactivate`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to reactivate estimate");
      }

      setStatus("PENDING");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsReactivating(false);
    }
  };

  if (status === "ACCEPTED") {
    return (
      <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-6 shadow-sm">
        <h3 className="text-xl font-semibold mb-2 flex items-center gap-2">
          <span>✓</span> Estimate Accepted
        </h3>
        <p>Thank you! Our team will contact you shortly to schedule the next steps for your modifications.</p>
      </div>
    );
  }

  if (status === "DECLINED") {
    return (
      <div className="bg-gray-100 border border-gray-200 text-gray-800 rounded-lg p-6 shadow-sm">
        <h3 className="text-xl font-semibold mb-2">Estimate Declined</h3>
        <p className="mb-2">You declined this estimate.</p>
        {declineReason && (
           <p className="italic text-gray-600 border-l-4 pl-4 mt-4">&quot;{declineReason}&quot;</p>
        )}
      </div>
    );
  }

  if (status === "EXPIRED") {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-6 shadow-sm">
        <h3 className="text-xl font-semibold mb-2">Estimate Expired</h3>
        <p className="mb-4">This estimate is no longer active. You can reactivate it to continue.</p>

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm" role="alert">
            {error}
          </div>
        )}

        <button
          onClick={handleReactivate}
          disabled={isReactivating}
          className="bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 rounded-md shadow-sm transition-colors disabled:opacity-50"
        >
          {isReactivating ? "Reactivating..." : "Reactivate Estimate"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white px-6 py-6 shadow sm:rounded-lg">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Your Decision</h3>
        
        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm" role="alert">
            {error}
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={() => handleResponse("ACCEPTED")}
            disabled={isSubmitting}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-md shadow-sm transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Processing..." : "Accept Estimate"}
          </button>
          
          <button
            onClick={() => setIsDeclining(true)}
            disabled={isSubmitting || isDeclining}
            className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold py-3 px-4 rounded-md shadow-sm transition-colors disabled:opacity-50"
          >
            Decline Estimate
          </button>
        </div>

        {isDeclining && (
           // If they clicked decline but hasn't submitted yet
           <div className="mt-8 p-6 bg-red-50 rounded-lg border border-red-100">
             <label htmlFor="reason" className="block text-sm font-medium text-red-800 mb-2">
               Please let us know why you are declining:
             </label>
             <select
               id="reason"
               value={declineReason}
               onChange={(e) => setDeclineReason(e.target.value)}
               className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-red-300 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm rounded-md mb-4"
             >
               <option value="" disabled>Select a reason...</option>
               <option value="Too expensive">Too expensive</option>
               <option value="Timeline is too long">Timeline is too long</option>
               <option value="Found another provider">Found another provider</option>
               <option value="Project scope changed">Project scope changed</option>
               <option value="Other">Other</option>
             </select>

             {declineReason === "Other" && (
               <div className="mb-4">
                 <input
                   type="text"
                   placeholder="Briefly explain..."
                   value={customReason}
                   onChange={(e) => setCustomReason(e.target.value)}
                   className="mt-1 block w-full p-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500"
                 />
               </div>
             )}

             <div className="flex gap-3">
               <button
                 onClick={() => handleResponse("DECLINED")}
                 disabled={isSubmitting || !declineReason || (declineReason === "Other" && !customReason)}
                 className="bg-red-600 text-white px-4 py-2 rounded shadow-sm hover:bg-red-700 disabled:opacity-50"
               >
                 Submit Decision
               </button>
               <button
                 onClick={() => {
                   setIsDeclining(false);
                   setError(null);
                 }}
                 disabled={isSubmitting}
                 className="text-gray-600 px-4 py-2 hover:underline disabled:opacity-50"
               >
                 Cancel
               </button>
             </div>
           </div>
        )}
      </div>
    </div>
  );
}
