"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileState } from "./actions";
import type { ProfileRow } from "@/lib/supabase/queries";

const initialState: ProfileState = { error: null };

const EXPERIENCE_OPTIONS = ["beginner", "intermediate", "advanced"] as const;
const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

export default function ProfileForm({ profile }: { profile: ProfileRow | null }) {
  const [state, formAction, pending] = useActionState(saveProfile, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        First name
        <input
          name="firstName"
          required
          defaultValue={profile?.first_name ?? ""}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <div className="flex gap-4">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Age
          <input
            name="age"
            type="number"
            min={13}
            max={100}
            required
            defaultValue={profile?.age ?? ""}
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Body weight
          <input
            name="bodyWeight"
            type="number"
            step="0.1"
            required
            defaultValue={profile?.body_weight ?? ""}
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Unit
          <select
            name="weightUnit"
            defaultValue={profile?.weight_unit ?? "lbs"}
            className="rounded-md border border-zinc-300 px-3 py-2"
          >
            <option value="lbs">lbs</option>
            <option value="kg">kg</option>
          </select>
        </label>
      </div>

      {(
        [
          ["runningExp", "Running experience", profile?.running_exp],
          ["hybridExp", "Hybrid fitness experience", profile?.hybrid_exp],
          ["liftingExp", "Lifting experience", profile?.lifting_exp],
        ] as const
      ).map(([name, label, current]) => (
        <label key={name} className="flex flex-col gap-1 text-sm">
          {label}
          <select
            name={name}
            defaultValue={current ?? "beginner"}
            className="rounded-md border border-zinc-300 px-3 py-2"
          >
            {EXPERIENCE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </option>
            ))}
          </select>
        </label>
      ))}

      <label className="flex flex-col gap-1 text-sm">
        Training classification
        <select
          name="trainingClass"
          defaultValue={profile?.training_class ?? "non_highly_trained"}
          className="rounded-md border border-zinc-300 px-3 py-2"
        >
          <option value="non_highly_trained">Non-highly trained</option>
          <option value="highly_trained">Highly trained</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">Training days (pick at least 3)</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((d) => (
            <label key={d.key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name={`day_${d.key}`}
                defaultChecked={profile?.training_days?.includes(d.key) ?? false}
              />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-black px-5 py-2.5 text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
