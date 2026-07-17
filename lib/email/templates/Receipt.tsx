import { Button, Link, Section, Text } from '@react-email/components';
import { Layout } from './_Layout';
import type { ReceiptProps } from './types';
import {
  button,
  card,
  cardCaption,
  cardText,
  footerLink,
  paragraph,
  paragraphLast,
  smallMuted,
} from './styles';

/**
 * Receipt / subscription confirmed — Stripe checkout.session.completed / invoice.paid.
 * Triggered from the Stripe webhook STRICTLY AFTER the existing entitlement write
 * (the webhook stays the sole entitlement writer; email must not touch it).
 * Category: billing / service. Subject: "You're all set — welcome to Duravel".
 */
export function Receipt({
  firstName,
  planLabel,
  amount,
  renewalDate,
  planUrl,
  invoiceUrl,
  billingPortalUrl,
}: ReceiptProps) {
  return (
    <Layout
      preview="Receipt inside. Your plan keeps adapting, uninterrupted."
      footnote="This is a receipt for your Duravel subscription."
      footerLinks={[{ label: 'Manage billing', href: billingPortalUrl }]}
    >
      <Text style={paragraph}>
        You&rsquo;re all set, {firstName} &mdash; thanks for backing Duravel. Your subscription is
        active and your plan keeps adapting without a break.
      </Text>

      <Section style={card}>
        <Text style={cardText}>
          <b>Plan</b> &nbsp;&mdash;&nbsp; {planLabel}
          <br />
          <b>Amount</b> &nbsp;&mdash;&nbsp; {amount}
          <br />
          <b>Renews</b> &nbsp;&mdash;&nbsp; {renewalDate}
        </Text>
        <Text style={cardCaption}>
          Full receipt:{' '}
          <Link href={invoiceUrl} style={footerLink}>
            view invoice
          </Link>
        </Text>
      </Section>

      <Text style={paragraphLast}>
        Nothing changes in your training &mdash; same plan, same logged history, still adapting week
        to week. Pick up right where you left off.
      </Text>

      <Button href={planUrl} style={button}>
        Open this week&rsquo;s plan &rarr;
      </Button>

      <Text style={smallMuted}>
        Manage billing anytime in your{' '}
        <Link href={billingPortalUrl} style={footerLink}>
          account
        </Link>
        . &mdash; Levi, Duravel
      </Text>
    </Layout>
  );
}

export default Receipt;
