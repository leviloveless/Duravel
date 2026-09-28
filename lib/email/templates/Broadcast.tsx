import { Button, Link, Text } from "@react-email/components";
import { Layout } from "./_Layout";
import type { BroadcastProps } from "./types";
import { button, footerLink, paragraph, smallMuted } from "./styles";

/**
 * A group email written by the admin in /admin/broadcast (2026-09-28).
 * Category: product / lifecycle — suppressible, carries a one-click unsubscribe,
 * and prints the postal address from EMAIL_POSTAL_ADDRESS (CAN-SPAM).
 * The admin's text is rendered as plain paragraphs: React escapes it, so nothing
 * typed there can inject markup into the email.
 */
export function Broadcast({
  firstName,
  paragraphs,
  button: cta,
  unsubscribeUrl,
  manageUrl,
  postalAddress,
}: BroadcastProps) {
  return (
    <Layout
      preview={paragraphs[0]?.slice(0, 110) ?? ""}
      footnote="You're getting this because you have a Duravel account and product updates are on."
      address={postalAddress}
      footerLinks={[
        { label: "Unsubscribe", href: unsubscribeUrl },
        { label: "Email preferences", href: manageUrl },
      ]}
    >
      <Text style={paragraph}>Hi {firstName},</Text>
      {paragraphs.map((p, i) => (
        <Text key={i} style={paragraph}>
          {p}
        </Text>
      ))}
      {cta ? (
        <Button href={cta.url} style={button}>
          {cta.label}
        </Button>
      ) : null}
      <Text style={smallMuted}>
        &mdash; Levi, Duravel ·{" "}
        <Link href={unsubscribeUrl} style={footerLink}>
          Unsubscribe from product updates
        </Link>
      </Text>
    </Layout>
  );
}

export default Broadcast;
