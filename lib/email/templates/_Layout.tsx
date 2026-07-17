import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';
import type { FooterLink } from './types';
import {
  MAILING_ADDRESS,
  bodySection,
  container,
  footerLink,
  footerSection,
  footerText,
  header,
  main,
  wordmark,
  wordmarkDot,
} from './styles';

interface LayoutProps {
  /** Preheader text shown in the inbox list. */
  preview: string;
  /** "You're getting this because…" reason line. */
  footnote: string;
  /** Footer action links (Manage preferences, Unsubscribe, Manage billing). */
  footerLinks: FooterLink[];
  children: ReactNode;
}

/**
 * Shared shell: orange-dot DURAVEL wordmark header, content, CAN-SPAM footer.
 * Every template composes this so the brand + legal footer stay identical.
 */
export function Layout({ preview, footnote, footerLinks, children }: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>
              <span style={wordmarkDot} />
              DURAVEL
            </Text>
          </Section>

          <Section style={bodySection}>{children}</Section>

          <Section style={footerSection}>
            <Text style={footerText}>
              {footnote}
              <br />
              Duravel &middot; {MAILING_ADDRESS}
              {footerLinks.map((link) => (
                <span key={link.href}>
                  {' '}
                  &middot;{' '}
                  <Link href={link.href} style={footerLink}>
                    {link.label}
                  </Link>
                </span>
              ))}
            </Text>
          </Section>
        </Container>
        {/* Hr kept out of the visible frame; present for clients that strip Container borders. */}
        <Hr style={{ display: 'none' }} />
      </Body>
    </Html>
  );
}

export default Layout;
