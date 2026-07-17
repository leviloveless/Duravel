import { Button, Section, Text } from '@react-email/components';
import { Layout } from './_Layout';
import type { WelcomeProps } from './types';
import {
  button,
  card,
  cardText,
  paragraph,
  paragraphTight,
  smallMuted,
} from './styles';

/**
 * Welcome — triggered on first authenticated session with a confirmed email.
 * Category: onboarding / service. Subject: "You're in — let's build your plan".
 */
export function Welcome({ firstName, generateUrl, trialEndDate, manageUrl }: WelcomeProps) {
  return (
    <Layout
      preview="Your 14-day trial is live. Here's your first move."
      footnote="You're getting this because you created a Duravel account."
      footerLinks={[{ label: 'Manage email preferences', href: manageUrl }]}
    >
      <Text style={paragraph}>
        Welcome, {firstName}. You&rsquo;re in &mdash; and your <b>14-day free trial</b> is live
        (no card, runs through {trialEndDate}).
      </Text>
      <Text style={paragraph}>
        Here&rsquo;s how Duravel works: you give it your benchmarks and your race, it builds a{' '}
        <b>periodized plan around you</b>, and every week it adapts from what you actually log.
        It&rsquo;s the structure a coach gives you &mdash; for a small fraction of the price.
      </Text>
      <Text style={paragraphTight}>Your first move is the only one that matters today:</Text>

      <Section style={card}>
        <Text style={cardText}>
          <b>Generate your program.</b> Answer a few questions about your current fitness and your
          goal race &mdash; Duravel builds the full block in about a minute.
        </Text>
      </Section>

      <Button href={generateUrl} style={button}>
        Build my program &rarr;
      </Button>

      <Text style={smallMuted}>
        Reply to this email if you get stuck &mdash; it comes straight to me. &mdash; Levi, Duravel
      </Text>
    </Layout>
  );
}

export default Welcome;
