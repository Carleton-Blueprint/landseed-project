"use client";

import React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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

const safetyList = [
    { id: "grab-bars", label: "Grab Bars" },
    { id: "ramps", label: "Ramps" },
    { id: "stair-lifts", label: "Stair Lifts" },
    { id: "wider-doors", label: "Wider Doors" },
    { id: "none", label: "None of these" },
];

export function GuidedIntakeForm({ onSubmitSuccess }: { onSubmitSuccess?: (values: FormValues) => void }) {
    const [isSubmitted, setIsSubmitted] = React.useState(false);
    const [estimateRange, setEstimateRange] = React.useState<{min: number, max: number} | null>(null);

    const {
        register,
        handleSubmit,
        control,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            safetyFeatures: [],
            additionalDetails: "",
        },
    });

    const calculateEstimate = (vals: FormValues) => {
        let min = 0;
        let max = 0;

        const pricing: Record<string, [number, number]> = {
            "grab-bars": [150, 300],
            "ramps": [500, 2500],
            "stair-lifts": [3000, 8000],
            "wider-doors": [800, 2000],
        };

        if (vals.safetyFeatures) {
            vals.safetyFeatures.forEach(sf => {
                if (pricing[sf]) {
                    min += pricing[sf][0];
                    max += pricing[sf][1];
                }
            });
        }

        if (vals.bathroomModifications === "yes") {
            min += 2000;
            max += 5000;
        } else if (vals.bathroomModifications === "not sure") {
            // If not sure, the minimum doesn't change much but maximum increases to account for possible mods
            max += 5000;
        }

        return { min, max };
    };

    const onSubmit = async (vals: FormValues) => {
        console.log("Form submitted", vals);
        // Fake wait
        await new Promise(r => setTimeout(r, 500));
        
        const estimate = calculateEstimate(vals);
        setEstimateRange(estimate);
        setIsSubmitted(true);

        if (onSubmitSuccess) {
            onSubmitSuccess(vals);
        }
    };

    if (isSubmitted && estimateRange) {
        return (
            <div className="max-w-2xl mx-auto p-8 border rounded shadow-sm text-center bg-gray-50">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-6">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold mb-4">Request Received!</h2>
                <p className="text-gray-600 mb-6">Thank you for submitting your needs assessment.</p>
                
                <div className="bg-white p-6 rounded-lg border shadow-sm mb-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">Initial Estimate</h3>
                    <p className="text-gray-500 text-sm mb-4">
                        This estimate range is dynamically generated from real-time external retail data based on your selected modifications. A formal quote will be provided after further review.
                        </p>
                    <div className="text-3xl font-bold text-blue-600">
                        ${estimateRange.min.toLocaleString()} - ${estimateRange.max.toLocaleString()}
                    </div>
                </div>

                <div className="text-sm text-gray-500">
                    <p>Our team will reach out to you within 1-2 business days.</p>
                </div>
                
                <button
                    onClick={() => {
                        setIsSubmitted(false);
                        setEstimateRange(null);
                    }}
                    className="mt-8 text-blue-600 hover:underline"
                >
                    Submit another request
                </button>
            </div>
        );
    }

    return (
        <form
            onSubmit={handleSubmit(onSubmit)}
            className="max-w-2xl mx-auto p-4 border rounded shadow-sm"
        >
            <div className="text-center mb-6">
                <h2 className="text-xl font-bold">Needs Assessment</h2>
                <p className="text-gray-500 text-sm">Please answer a few questions.</p>
            </div>

            <div className="space-y-4">
                {/* Q1 */}
                <div className="p-3 border bg-gray-50 rounded">
                    <p className="font-semibold mb-2">1. Do you use mobility assistance?</p>
                    <div className="flex gap-4">
                        <label className="flex items-center gap-1">
                            <input type="radio" value="yes" {...register("mobilityAssistance")} />
                            Yes
                        </label>
                        <label className="flex items-center gap-1">
                            <input type="radio" value="no" {...register("mobilityAssistance")} />
                            No
                        </label>
                    </div>
                    {errors.mobilityAssistance && <p className="text-red-500 text-xs mt-1">{errors.mobilityAssistance.message}</p>}
                </div>

                {/* Q2 */}
                <div className="p-3 border bg-gray-50 rounded">
                    <p className="font-semibold mb-2">2. Which safety features do you want?</p>
                    <div className="grid grid-cols-2 gap-2">
                        <Controller
                            name="safetyFeatures"
                            control={control}
                            render={({ field }) => (
                                <>
                                    {safetyList.map((item) => (
                                        <label key={item.id} className="flex items-center gap-1">
                                            <input
                                                type="checkbox"
                                                checked={field.value?.includes(item.id)}
                                                onChange={(e) => {
                                                    let cv = field.value || [];
                                                    if (e.target.checked) {
                                                        if (item.id === "none") {
                                                            cv = ["none"];
                                                        } else {
                                                            cv = cv.filter(x => x !== "none");
                                                            cv.push(item.id);
                                                        }
                                                    } else {
                                                        cv = cv.filter((x) => x !== item.id);
                                                    }
                                                    field.onChange(cv);
                                                }}
                                            />
                                            <span className="text-sm">{item.label}</span>
                                        </label>
                                    ))}
                                </>
                            )}
                        />
                    </div>
                    {errors.safetyFeatures && <p className="text-red-500 text-xs mt-1">{errors.safetyFeatures.message}</p>}
                </div>

                {/* Q3 */}
                <div className="p-3 border bg-gray-50 rounded">
                    <p className="font-semibold mb-2">3. Do you need bathroom mods?</p>
                    <div className="flex flex-col gap-1">
                        {[
                            { v: "yes", l: "Yes" },
                            { v: "no", l: "No" },
                            { v: "not sure", l: "Not sure" }
                        ].map(opt => (
                            <label key={opt.v} className="flex items-center gap-1">
                                <input type="radio" value={opt.v} {...register("bathroomModifications")} />
                                <span className="text-sm">{opt.l}</span>
                            </label>
                        ))}
                    </div>
                    {errors.bathroomModifications && <p className="text-red-500 text-xs mt-1">{errors.bathroomModifications.message}</p>}
                </div>

                {/* Q4 */}
                <div className="p-3 border bg-gray-50 rounded">
                    <p className="font-semibold mb-2">4. What is your timeline?</p>
                    <select
                        className="w-full p-2 border rounded"
                        {...register("urgency")}
                    >
                        <option value="" disabled hidden>Pick one...</option>
                        <option value="immediate">Immediate (1-2 weeks)</option>
                        <option value="soon">Soon (1-3 months)</option>
                        <option value="planning">Planning (3+ months)</option>
                        <option value="just exploring">No timeline</option>
                    </select>
                    {errors.urgency && <p className="text-red-500 text-xs mt-1">{errors.urgency.message}</p>}
                </div>

                {/* Q5 */}
                <div className="p-3 border bg-gray-50 rounded">
                    <p className="font-semibold mb-2">5. Any other details? (Optional)</p>
                    <textarea
                        rows={3}
                        className="w-full p-2 border rounded"
                        {...register("additionalDetails")}
                    />
                    {errors.additionalDetails && <p className="text-red-500 text-xs mt-1">{errors.additionalDetails.message}</p>}
                </div>
            </div>

            <div className="mt-4 pt-4 border-t text-right">
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {isSubmitting ? "Sending..." : "Submit Form"}
                </button>
            </div>
        </form>
    );
}
