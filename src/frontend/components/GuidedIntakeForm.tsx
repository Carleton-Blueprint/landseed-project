"use client";

import React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";
import type { GuidedData } from "@/backend/schemas/intakeDraft";

const schema = z.object({
  mobilityAssistance: z.enum(["yes", "no"], {
    required_error: "Please let us know if you need help.",
  }),
  safetyFeatures: z.array(z.string()).min(1, "Please select at least one option."),
  bathroomModifications: z.enum(["yes", "no", "not sure"], {
    required_error: "Do you need bathroom mods?",
  }),
  urgency: z.enum(["immediate", "soon", "planning", "just exploring"], {
    required_error: "When do you need it?",
  }),
  additionalDetails: z.string().max(500, "Details too long").optional(),
});

export type FormValues = z.infer<typeof schema>;

const defaultValues: Partial<FormValues> = {
  safetyFeatures: [],
  additionalDetails: "",
};

const safetyList = [
  { id: "grab-bars", label: "Grab Bars" },
  { id: "ramps", label: "Ramps" },
  { id: "stair-lifts", label: "Stair Lifts" },
  { id: "wider-doors", label: "Wider Doors" },
  { id: "none", label: "None of these" },
];

function toGuidedData(values: FormValues): GuidedData {
  return {
    mobilityAssistance: values.mobilityAssistance,
    safetyFeatures: values.safetyFeatures,
    bathroomModifications: values.bathroomModifications,
    urgency: values.urgency,
    additionalDetails: values.additionalDetails,
  };
}

export function GuidedIntakeForm() {
  const { guidedData, isHydrated, setGuidedSnapshot } = useIntakeDraft();

  const {
    register,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  // Only reset back to blank when guidedData goes from present to absent
  // (an explicit discard while this form is mounted) — not on the ordinary
  // "just hydrated, no draft ever existed" case, which would otherwise wipe
  // out anything the user already selected while hydration was still pending.
  const hadGuidedDataRef = React.useRef(false);

  React.useEffect(() => {
    if (!isHydrated) return;
    if (!guidedData) {
      if (hadGuidedDataRef.current) {
        reset(defaultValues as FormValues);
      }
      hadGuidedDataRef.current = false;
      return;
    }
    hadGuidedDataRef.current = true;
    reset({
      ...defaultValues,
      ...guidedData,
      safetyFeatures: guidedData.safetyFeatures ?? [],
      additionalDetails: guidedData.additionalDetails ?? "",
    } as FormValues);
  }, [guidedData, isHydrated, reset]);

  React.useEffect(() => {
    if (!isHydrated) return;

    const subscription = watch((values) => {
      setGuidedSnapshot(toGuidedData(values as FormValues));
    });
    return () => subscription.unsubscribe();
  }, [watch, setGuidedSnapshot, isHydrated]);

  return (
    <div className="max-w-2xl mx-auto rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Needs Assessment</h2>
        <p className="text-gray-500 text-sm mt-1">Please answer a few questions.</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-5">
          <p className="font-semibold text-gray-900 mb-3">1. Do you use mobility assistance?</p>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" value="yes" {...register("mobilityAssistance")} className="h-4 w-4 accent-emerald-600" />
              Yes
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" value="no" {...register("mobilityAssistance")} className="h-4 w-4 accent-emerald-600" />
              No
            </label>
          </div>
          {errors.mobilityAssistance && (
            <p className="text-red-500 text-xs mt-2">{errors.mobilityAssistance.message}</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-5">
          <p className="font-semibold text-gray-900 mb-3">2. Which safety features do you want?</p>
          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="safetyFeatures"
              control={control}
              render={({ field }) => (
                <>
                  {safetyList.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={field.value?.includes(item.id)}
                        className="h-4 w-4 rounded border-gray-300 accent-emerald-600"
                        onChange={(e) => {
                          let cv = field.value || [];
                          if (e.target.checked) {
                            if (item.id === "none") {
                              cv = ["none"];
                            } else {
                              cv = cv.filter((x) => x !== "none");
                              cv.push(item.id);
                            }
                          } else {
                            cv = cv.filter((x) => x !== item.id);
                          }
                          field.onChange(cv);
                        }}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </>
              )}
            />
          </div>
          {errors.safetyFeatures && (
            <p className="text-red-500 text-xs mt-2">{errors.safetyFeatures.message}</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-5">
          <p className="font-semibold text-gray-900 mb-3">3. Do you need bathroom mods?</p>
          <div className="flex flex-col gap-2">
            {[
              { v: "yes", l: "Yes" },
              { v: "no", l: "No" },
              { v: "not sure", l: "Not sure" },
            ].map((opt) => (
              <label key={opt.v} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" value={opt.v} {...register("bathroomModifications")} className="h-4 w-4 accent-emerald-600" />
                <span>{opt.l}</span>
              </label>
            ))}
          </div>
          {errors.bathroomModifications && (
            <p className="text-red-500 text-xs mt-2">{errors.bathroomModifications.message}</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-5">
          <p className="font-semibold text-gray-900 mb-3">4. What is your timeline?</p>
          <select
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-base shadow-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:text-sm"
            aria-label="What is your timeline?"
            {...register("urgency")}
          >
            <option value="" disabled hidden>
              Pick one...
            </option>
            <option value="immediate">Immediate (1-2 weeks)</option>
            <option value="soon">Soon (1-3 months)</option>
            <option value="planning">Planning (3+ months)</option>
            <option value="just exploring">No timeline</option>
          </select>
          {errors.urgency && (
            <p className="text-red-500 text-xs mt-2">{errors.urgency.message}</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-5">
          <p className="font-semibold text-gray-900 mb-3">5. Any other details? (Optional)</p>
          <textarea
            rows={3}
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-base shadow-sm transition-colors focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:text-sm"
            aria-label="Any other details (optional)"
            {...register("additionalDetails")}
          />
          {errors.additionalDetails && (
            <p className="text-red-500 text-xs mt-2">{errors.additionalDetails.message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
