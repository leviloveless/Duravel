import { Button, Link, Section, Text } from "@react-email/components";
import { Layout } from "./_Layout";
import type { TrialNoticeProps } from "./types";
import { button, card, cardText, footerLink, paragraph, paragraphLast, smallMuted } from "./styles";

/**
 * Carded-trial notices (2026-09-28): "started" when the trial begins, "ending"
 * about three days before the card is charged. See lib/email/trial-notice.ts.
 *
 * Both say, in this order: what happens, how much, on what date, and how to stop
 * it. That is the content an automatic-renewal notice has to carry, and it is
 * also simply what someone who handed over a card for a free trial wants to know.
 * Category: billing / service (not suppressible — it is an account notice).
 */
export function TrialNotice({
  kind,
  firstName,
  planLabel,
  priceLine,
  chargeDate,
  trialDays,
  cancelUrl,
  planUrl,
  manageUrl,
}: TrialNoticeProps) {
  const ending = kind === "ending";
  return (
    <Layout
      preview={
        ending
          ? `Your ${planLabel} plan starts ${chargeDate}: ${priceLine}. Cancel anytime before then.`
          : `Nothing is charged until ${chargeDate}. Cancel anytime before then.`
      }
      footnote="You're getting this because you started a Duravel free trial — an account & billing notice."
      footerLinks={[
        { label: "Manage billing", href: cancelUrl },
        { label: "Email preferences", href: manageUrl },
      ]}
    >
      <Text style={paragraph}>
        {ending
          ? `Hi ${firstName} — a heads-up that your Duravel free trial ends soon.`
          : `Hi ${firstName} — your ${trialDays}-day Duravel free trial has started.`}
      </Text>

      <Section style={card}>
        <Text style={cardText}>
          <b>Plan</b> &nbsp;&mdash;&nbsp; {planLabel}
          <br />
          <b>First charge</b> &nbsp;&mdash;&nbsp; {priceLine}
          <br />
          <b>Charged on</b> &nbsp;&mdash;&nbsp; {chargeDate}
        </Text>
      </Section>

      <Text style={paragraph}>
        {ending
          ? `On ${chargeDate} your card on file will be charged ${priceLine} and your ${planLabel} plan continues automatically, renewing each period until you cancel.`
          : `Nothing is charged today. On ${chargeDate} your card on file will be charged ${priceLine}, and your ${planLabel} plan continues automatically, renewing each period until you cancel.`}
      </Text>

      <Text style={paragraphLast}>
        Don&rsquo;t want to continue? Cancel before {chargeDate} and you won&rsquo;t be charged. It
        takes a minute in{" "}
        <Link href={cancelUrl} style={footerLink}>
          Settings → Manage billing
        </Link>
        .
      </Text>

      <Button href={planUrl} style={button}>
        {ending ? "Open this week's plan →" : "Start training →"}
      </Button>

      <Text style={smallMuted}>Questions? Reply to this email. &mdash; Levi, Duravel</Text>
    </Layout>
  );
}

export default TrialNotice;
