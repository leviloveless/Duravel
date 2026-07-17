import { Button, Text } from '@react-email/components';
import { Layout } from './_Layout';
import type { OnboardingNudgeProps } from './types';
import { button, paragraph, paragraphLast, smallMuted } from './styles';

/**
 * Onboarding nudge — signed up 2-3 days ago AND no program generated.
 * Category: onboarding / lifecycle (suppressible → real unsubscribe + RFC 8058).
 * Subject: "Your plan is one step away".
 */
export function OnboardingNudge({
  firstName,
  generateUrl,
  daysLeft,
  manageUrl,
  unsubscribeUrl,
}: OnboardingNudgeProps) {
  return (
    <Layout
      preview="You've got trial days ticking — let's not waste them."
      footnote="You're getting this because you created a Duravel account."
      footerLinks={[
        { label: 'Manage preferences', href: manageUrl },
        { label: 'Unsubscribe', href: unsubscribeUrl },
      ]}
    >
      <Text style={paragraph}>
        {firstName} &mdash; you signed up but haven&rsquo;t generated a plan yet, and I didn&rsquo;t
        want your trial to quietly tick down without you seeing what Duravel actually does.
      </Text>
      <Text style={paragraph}>
        It takes about a minute. You answer a few questions, and Duravel hands you a full periodized
        block built around <i>your</i> numbers &mdash; not a generic template. That&rsquo;s the whole
        thing you&rsquo;re here to try.
      </Text>
      <Text style={paragraphLast}>
        You&rsquo;ve got <b>{daysLeft} days left</b> in your free trial. Plenty of time to run a real
        week and see how it feels.
      </Text>

      <Button href={generateUrl} style={button}>
        Build my plan &rarr;
      </Button>

      <Text style={smallMuted}>&mdash; Levi</Text>
    </Layout>
  );
}

export default OnboardingNudge;
