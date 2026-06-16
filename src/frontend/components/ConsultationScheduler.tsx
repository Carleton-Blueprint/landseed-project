"use client";

import React, { useState, useEffect, useCallback } from "react";
import { CalendarIcon, ClockIcon } from "@/frontend/components/icons";

interface ConsultationRequest {
  id: string;
  projectId: string;
  scheduledAt: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
  notes: string | null;
}

export interface ConsultationSchedulerProps {
  projectId: string;
  onScheduled?: (consultation: ConsultationRequest) => void;
}

function getBusinessDays(count: number): Date[] {
  const days: Date[] = [];
  let current = new Date();
  
  while (days.length < count) {
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(new Date(current));
    }
  }
  return days;
}

const TIME_SLOTS = [
  { value: "09:00", label: "9:00 AM" },
  { value: "10:30", label: "10:30 AM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "15:30", label: "3:30 PM" },
];

export function ConsultationScheduler({ projectId, onScheduled }: ConsultationSchedulerProps) {
  const [consultation, setConsultation] = useState<ConsultationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const businessDays = getBusinessDays(10);

  const fetchConsultation = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/project/${projectId}/consultation`);
      if (!res.ok) throw new Error("Failed to fetch consultation details");
      const data = await res.json();
      setConsultation(data.consultation);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error loading consultation scheduler");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchConsultation();
  }, [fetchConsultation]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime) {
      setError("Please select both a date and a time slot.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const scheduledDate = new Date(selectedDate);
    const [hours, minutes] = selectedTime.split(":");
    scheduledDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    try {
      const res = await fetch(`/api/project/${projectId}/consultation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: scheduledDate.toISOString(),
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to schedule consultation");
      }

      const data = await res.json();
      setConsultation(data.consultation);
      setIsEditing(false);
      if (onScheduled) {
        onScheduled(data.consultation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error submitting request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel your scheduled meeting?")) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/project/${projectId}/consultation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: consultation!.scheduledAt,
          status: "CANCELLED",
        }),
      });

      if (!res.ok) throw new Error("Failed to cancel meeting");
      const data = await res.json();
      setConsultation(data.consultation);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cancelling meeting");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-6 shadow-sm flex flex-col items-center justify-center min-h-[200px]">
        <div className="h-6 w-6 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mb-2" />
        <p className="text-sm text-gray-500">Loading scheduling information...</p>
      </div>
    );
  }

  const hasMeeting = consultation && consultation.status !== "CANCELLED";

  if (hasMeeting && !isEditing) {
    const meetingDate = new Date(consultation.scheduledAt);
    const dateFormatted = meetingDate.toLocaleDateString("en-CA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeFormatted = meetingDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    const isConfirmed = consultation.status === "CONFIRMED";

    return (
      <div id="consultation-scheduled-card" className="rounded-xl border bg-white overflow-hidden shadow-sm transition-all hover:shadow-md">
        <div className={`p-4 text-white flex items-center justify-between ${
          isConfirmed ? "bg-gradient-to-r from-emerald-600 to-teal-600" : "bg-gradient-to-r from-indigo-900 to-indigo-800"
        }`}>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">
              {isConfirmed ? "📅" : "⏳"}
            </span>
            <div>
              <h3 className="font-bold text-sm sm:text-base">
                Budget Approval Meeting {isConfirmed ? "Confirmed" : "Pending Confirmation"}
              </h3>
              <p className="text-xs opacity-80">
                {isConfirmed ? "Your advisory team has locked in this time." : "Waiting for advisor validation."}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold uppercase bg-white/20 px-2 py-0.5 rounded-full">
            {consultation.status}
          </span>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <div className="flex-1 bg-gray-50 rounded-lg p-3 border border-gray-100 flex items-center gap-3">
              <CalendarIcon size={20} className="text-indigo-600 shrink-0" />
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Date</p>
                <p className="text-sm font-medium text-gray-800">{dateFormatted}</p>
              </div>
            </div>

            <div className="flex-1 bg-gray-50 rounded-lg p-3 border border-gray-100 flex items-center gap-3">
              <ClockIcon size={20} className="text-indigo-600 shrink-0" />
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Time</p>
                <p className="text-sm font-medium text-gray-800">{timeFormatted}</p>
              </div>
            </div>
          </div>

          {consultation.notes && (
            <div className="bg-gray-50/50 rounded-lg p-3 border border-dashed border-gray-200">
              <p className="text-xs text-gray-500 font-bold mb-1">Your notes/comments:</p>
              <p className="text-sm text-gray-700 italic">&ldquo;{consultation.notes}&rdquo;</p>
            </div>
          )}

          {error && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-100">{error}</div>}

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => {
                setSelectedDate(new Date(consultation.scheduledAt));
                const hour = meetingDate.getHours();
                const minute = meetingDate.getMinutes().toString().padStart(2, "0");
                setSelectedTime(`${hour.toString().padStart(2, "0")}:${minute}`);
                setNotes(consultation.notes || "");
                setIsEditing(true);
              }}
              disabled={submitting}
              className="flex-1 py-2 px-4 rounded-lg text-sm font-semibold border border-indigo-200 bg-white text-indigo-700 transition-all hover:bg-indigo-50 active:scale-[0.98]"
            >
              Reschedule
            </button>
            <button
              onClick={handleCancel}
              disabled={submitting}
              className="flex-1 py-2 px-4 rounded-lg text-sm font-semibold border border-red-200 bg-white text-red-600 transition-all hover:bg-red-50 active:scale-[0.98]"
            >
              Cancel Meeting
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="consultation-scheduler-card" className="rounded-xl border bg-white p-5 shadow-sm space-y-4 transition-all hover:shadow-md">
      <div>
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <CalendarIcon className="text-indigo-600" />
          Mandatory Consultation Meeting
        </h3>
        <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
          {isEditing
            ? "Choose a new date and time for your budget approval consultation."
            : "To finalize your project budget and submit for official grant approval, you must schedule a final 30-minute consultation meeting with our advisory team."}
        </p>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-100">{error}</div>}

      <form onSubmit={handleSchedule} className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
            Select a Date
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {businessDays.map((date) => {
              const isSelected = selectedDate && selectedDate.toDateString() === date.toDateString();
              const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
              const dayNum = date.getDate();
              const monthName = date.toLocaleDateString("en-US", { month: "short" });

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  className={`py-2 px-3 rounded-lg border text-center transition-all flex flex-col items-center justify-center gap-0.5 active:scale-95 ${
                    isSelected
                      ? "border-indigo-600 bg-indigo-50 text-indigo-900 font-bold shadow-sm"
                      : "border-gray-200 hover:border-indigo-400 hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <span className="text-[10px] uppercase opacity-60 font-semibold">{dayName}</span>
                  <span className="text-lg leading-tight">{dayNum}</span>
                  <span className="text-[10px] font-medium">{monthName}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selectedDate && (
          <div className="space-y-2 animate-fadeIn">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
              Available Time Slots
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIME_SLOTS.map((slot) => {
                const isSelected = selectedTime === slot.value;
                return (
                  <button
                    key={slot.value}
                    type="button"
                    onClick={() => setSelectedTime(slot.value)}
                    className={`py-2 px-3 rounded-lg border text-center text-sm transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50 text-indigo-900 font-bold shadow-sm"
                        : "border-gray-200 hover:border-indigo-400 hover:bg-gray-50 text-gray-700"
                    }`}
                  >
                    <ClockIcon size={14} className={isSelected ? "text-indigo-600" : "text-gray-400"} />
                    {slot.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {selectedDate && selectedTime && (
          <div className="space-y-2 animate-fadeIn">
            <label htmlFor="scheduler-notes" className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
              Additional Notes (Optional)
            </label>
            <textarea
              id="scheduler-notes"
              rows={2}
              placeholder="Any details or questions you'd like to address..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full text-sm rounded-lg border border-gray-200 bg-gray-50 py-2 px-3 text-gray-900 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 placeholder:text-gray-400"
            />
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {isEditing && (
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              disabled={submitting}
              className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold border border-gray-200 bg-white text-gray-700 transition-all hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            id="submit-consultation-btn"
            disabled={submitting || !selectedDate || !selectedTime}
            className={`flex-[2] py-2.5 px-4 rounded-lg text-sm font-bold text-white transition-all shadow-sm active:scale-[0.98] ${
              !selectedDate || !selectedTime
                ? "bg-gray-300 cursor-not-allowed"
                : submitting
                ? "bg-indigo-400 cursor-wait"
                : "bg-gradient-to-r from-indigo-700 to-indigo-600 hover:from-indigo-800 hover:to-indigo-700 shadow-indigo-100"
            }`}
          >
            {submitting
              ? "Submitting Request..."
              : isEditing
              ? "Confirm Reschedule"
              : "Schedule Consultation Meeting"}
          </button>
        </div>
      </form>
    </div>
  );
}
