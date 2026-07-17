import "server-only";
import { render } from "@react-email/render";
import { Welcome } from "./templates/Welcome";
import { OnboardingNudge } from "./templates/OnboardingNudge";
import { TrialEnding } from "./templates/TrialEnding";
import { Receipt } from "./templates/Receipt";
import type {
  OnboardingNudgeProps,
  ReceiptProps,
  TrialEndingProps,
  WelcomeProps,
} from "./templates/types";

/**
 * Maps a render job to the right React Email component and produces { subject, html,
 * text }. Subjects live here (07-spec: not in the template); the preheader is baked
 * into each component's <Preview>.
 */
export type RenderJob =
  | { template: "welcome"; props: WelcomeProps }
  | { template: "onboarding_nudge"; props: OnboardingNudgeProps }
  | { template: "trial_ending"; props: TrialEndingProps }
  | { template: "receipt"; props: ReceiptProps };

const SUBJECTS = {
  welcome: "You're in — let's build your plan",
  onboarding_nudge: "Your plan is one step away",
  receipt: "You're all set — welcome to Duravel",
} as const;

const TRIAL_SUBJECTS = {
  "T-3": "3 days left on your Duravel trial",
  "T-1": "Your Duravel trial ends tomorrow",
  "T-0": "Your trial ends today — keep your plan",
} as const;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderEmail(job: RenderJob): Promise<RenderedEmail> {
  const element =
    job.template === "welcome" ? (
      <Welcome {...job.props} />
    ) : job.template === "onboarding_nudge" ? (
      <OnboardingNudge {...job.props} />
    ) : job.template === "trial_ending" ? (
      <TrialEnding {...job.props} />
    ) : (
      <Receipt {...job.props} />
    );

  const subject =
    job.template === "trial_ending" ? TRIAL_SUBJECTS[job.props.stage] : SUBJECTS[job.template];

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
