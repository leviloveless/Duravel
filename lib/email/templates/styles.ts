import type { CSSProperties } from 'react';

/**
 * Shared design tokens + style objects for all Duravel emails.
 * Mirrors the live auth / nurture templates exactly (Duravel_Email_Templates.html):
 * paper #eceae6, ink #0E1116, orange dot #FF5A1F, 600px column, Arial stack.
 *
 * Email clients ignore <style> and external fonts unreliably, so every style is
 * inline and the font is the system Arial stack — no web fonts.
 */

// CAN-SPAM postal identity line. Matches the address already used in the live
// /pace + /deka Resend footers. Swap if the Mercury/relocation address supersedes it.
export const MAILING_ADDRESS = '5900 Balcones Dr STE 100, Austin, TX 78731';

export const colors = {
  ink: '#0E1116',
  orange: '#FF5A1F',
  text: '#2b3138',
  quoteText: '#3a4048',
  subtle: '#5b616a',
  muted: '#8A8F98',
  border: '#E7E3DC',
  paper: '#eceae6',
  card: '#F7F5F2',
  white: '#ffffff',
} as const;

const FONT_STACK = 'Arial, Helvetica, sans-serif';

export const main: CSSProperties = {
  backgroundColor: colors.paper,
  fontFamily: FONT_STACK,
  margin: 0,
  padding: 0,
};

export const container: CSSProperties = {
  backgroundColor: colors.white,
  maxWidth: '600px',
  margin: '0 auto',
};

export const header: CSSProperties = {
  padding: '22px 34px 8px',
};

export const wordmark: CSSProperties = {
  fontFamily: FONT_STACK,
  fontWeight: 800,
  fontSize: '15px',
  letterSpacing: '0.14em',
  color: colors.ink,
  margin: 0,
};

export const wordmarkDot: CSSProperties = {
  display: 'inline-block',
  width: '9px',
  height: '9px',
  borderRadius: '50%',
  backgroundColor: colors.orange,
  marginRight: '8px',
};

export const bodySection: CSSProperties = {
  padding: '6px 34px 26px',
};

export const paragraph: CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '15px',
  lineHeight: '1.62',
  color: colors.text,
  margin: '0 0 14px',
};

export const paragraphTight: CSSProperties = {
  ...paragraph,
  margin: '0 0 10px',
};

export const paragraphLast: CSSProperties = {
  ...paragraph,
  margin: '0 0 20px',
};

export const card: CSSProperties = {
  backgroundColor: colors.card,
  borderRadius: '10px',
  padding: '16px 18px',
  margin: '0 0 18px',
};

export const cardText: CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '14px',
  lineHeight: '1.6',
  color: colors.text,
  margin: 0,
};

export const quote: CSSProperties = {
  borderLeft: `3px solid ${colors.orange}`,
  padding: '4px 0 4px 16px',
  margin: '0 0 18px',
};

export const quoteText: CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '15px',
  lineHeight: '1.6',
  color: colors.quoteText,
  margin: 0,
};

export const button: CSSProperties = {
  backgroundColor: colors.ink,
  color: colors.white,
  fontFamily: FONT_STACK,
  fontWeight: 700,
  fontSize: '14px',
  textDecoration: 'none',
  padding: '13px 26px',
  borderRadius: '8px',
  display: 'inline-block',
};

export const smallMuted: CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '13px',
  lineHeight: '1.5',
  color: colors.muted,
  margin: '14px 0 0',
};

export const cardCaption: CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '12px',
  lineHeight: '1.5',
  color: colors.muted,
  margin: '6px 0 0',
};

export const footerSection: CSSProperties = {
  padding: '18px 34px 26px',
  borderTop: `1px solid ${colors.border}`,
};

export const footerText: CSSProperties = {
  fontFamily: FONT_STACK,
  fontSize: '11px',
  lineHeight: '1.6',
  color: colors.muted,
  margin: 0,
};

export const footerLink: CSSProperties = {
  color: colors.muted,
  textDecoration: 'underline',
};

export const inlineLink: CSSProperties = {
  color: colors.ink,
  textDecoration: 'underline',
};
