import { Button, Section, Text } from '@react-email/components';
import { Layout } from './_Layout';
import type { TrialEndingProps, TrialEndingStage } from './types';
import {
  button,
  card,
  cardCaption,
  cardText,
  inlineLink,
  paragraph,
  paragraphLast,
  quote,
  quoteText,
  smallMuted,
} from './styles';

const PREVIEW: Record<TrialEndingStage, string> = {
  'T-3': 'Your plan — and your logged progress — stays with you.',
  'T-1': 'Two clicks to keep your plan adapting.',
  'T-0': 'Last call. Lock in $119.99/yr before it pauses.',
};

const FOOTNOTE =
  "You're getting this because your Duravel trial is ending — an account & billing notice.";

function hasProgress(sessions: number | undefined): sessions is number {
  return typeof sessions === 'number' && sessions > 0;
}

/**
 * Trial-ending T-3 / T-1 / T-0 — trial_started_at + {11,13,14}d reached AND no active sub.
 * Category: billing / service (non-suppressible; footer = "Manage email preferences").
 * Leads with the user's OWN logged progress (07-spec §6.2/§8.1); degrades gracefully
 * to a value-recap variant when sessionsLogged is 0/undefined.
 *
 * IMPORTANT: the flow must run a late entitlement re-check immediately before send
 * (07-spec §4.1 step 7) so this never fires for someone who subscribed the same morning.
 */
export function TrialEnding(props: TrialEndingProps) {
  const { stage, manageUrl } = props;
  return (
    <Layout
      preview={PREVIEW[stage]}
      footnote={FOOTNOTE}
      footerLinks={[{ label: 'Manage email preferences', href: manageUrl }]}
    >
      {stage === 'T-3' && <BodyT3 {...props} />}
      {stage === 'T-1' && <BodyT1 {...props} />}
      {stage === 'T-0' && <BodyT0 {...props} />}
    </Layout>
  );
}

function BodyT3({
  firstName,
  sessionsLogged,
  weeksCompleted,
  programName,
  subscribeUrl,
}: TrialEndingProps) {
  const showStat = hasProgress(sessionsLogged);
  return (
    <>
      <Text style={paragraph}>
        {firstName} &mdash; your free trial ends in <b>3 days</b>.
        {showStat ? ' Quick recap of what you’ve built so far:' : ''}
      </Text>

      {showStat && (
        <Section style={card}>
          <Text style={cardText}>
            <b>
              {sessionsLogged} sessions logged
            </b>
            {typeof weeksCompleted === 'number' ? (
              <>
                {' '}
                across <b>{weeksCompleted} weeks</b>
              </>
            ) : null}
            {programName ? <> of your {programName}</> : null}.
          </Text>
          <Text style={cardCaption}>
            Every one of those feeds the plan &mdash; Duravel is already tuning your next weeks from
            what you&rsquo;ve done.
          </Text>
        </Section>
      )}

      <Text style={paragraph}>
        {showStat
          ? 'That’s the part most apps can’t give you: the plan isn’t static, it’s learning you. Walk away now and it pauses — the adaptive thread you’ve started resets.'
          : 'The part most apps can’t give you is that your plan isn’t static — it adapts to you week to week. Walk away now and it pauses.'}
      </Text>
      <Text style={paragraphLast}>
        Keep it going for <b>$19.99/mo</b> or <b>$119.99/yr</b>. Cancel anytime, in two clicks.
      </Text>

      <Button href={subscribeUrl} style={button}>
        Keep my plan &rarr;
      </Button>
      <Text style={smallMuted}>&mdash; Levi, Duravel</Text>
    </>
  );
}

function BodyT1({ firstName, sessionsLogged, subscribeUrl }: TrialEndingProps) {
  const showStat = hasProgress(sessionsLogged);
  return (
    <>
      <Text style={paragraph}>
        {firstName} &mdash; your trial ends <b>tomorrow</b>. After that, your plan stops adapting and
        new weeks won&rsquo;t generate.
      </Text>
      <Text style={paragraph}>
        {showStat ? (
          <>
            You&rsquo;ve already put <b>{sessionsLogged} sessions</b> into this. The work is done
            &mdash; the only thing left is to not let the plan go quiet right when it&rsquo;s dialed in
            to you.
          </>
        ) : (
          <>
            You&rsquo;ve done the hard part by starting. The only thing left is to not let the plan go
            quiet right when it&rsquo;s dialed in to you.
          </>
        )}
      </Text>
      <Text style={paragraphLast}>
        Keep everything running for <b>$19.99/mo</b> (or <b>$119.99/yr</b> &mdash; about six months
        free). Two clicks, cancel anytime.
      </Text>

      <Button href={subscribeUrl} style={button}>
        Keep my plan &rarr;
      </Button>
      <Text style={smallMuted}>&mdash; Levi</Text>
    </>
  );
}

function BodyT0({ firstName, subscribeUrl, annualUrl }: TrialEndingProps) {
  return (
    <>
      <Text style={paragraph}>
        {firstName} &mdash; this is the last one: your free trial ends <b>today</b>. When it does,
        your plan stops adapting and new weeks won&rsquo;t build.
      </Text>
      <Text style={paragraph}>
        If Duravel earned a spot in your training, keep it going. Everything you&rsquo;ve logged
        stays, and the plan picks up exactly where you are.
      </Text>

      <Section style={quote}>
        <Text style={quoteText}>
          <b>Go annual and save.</b> $119.99/yr works out to about <b>$10/mo</b> &mdash; roughly
          six months free versus monthly. Best value if you&rsquo;re training toward a race this year.
        </Text>
      </Section>

      <Button href={annualUrl} style={button}>
        Keep my plan &mdash; $119.99/yr &rarr;
      </Button>
      <Text style={{ ...paragraph, fontSize: '13px', margin: '12px 0 0' }}>
        Prefer monthly?{' '}
        <a href={subscribeUrl} style={inlineLink}>
          Continue at $19.99/mo &rarr;
        </a>
      </Text>
      <Text style={smallMuted}>Either way &mdash; proud of the work you put in. &mdash; Levi</Text>
    </>
  );
}

export default TrialEnding;
