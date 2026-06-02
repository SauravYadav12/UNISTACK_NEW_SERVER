/**
 * Onboarding emails — five variants share one branded shell so HR can
 * see consistent layout across every candidate touchpoint:
 *
 *   - OnboardingInvite        — "fill this onboarding form"
 *   - OnboardingInfoRequest   — free-text follow-up after HR review
 *   - BgCheckStarted          — "your background check is underway"
 *   - OfferLetterEmail        — "your offer is ready, click to sign"
 *   - OfferAcceptedEmail      — confirmation after the candidate signs
 *
 * Each variant takes a tiny props bag; the shared `<Shell>` carries
 * BrandHeader + body container + footer so the components stay short
 * and the email-client rendering stays predictable.
 */

import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BRAND, emailStyles } from "./shared-styles";
import BrandHeader from "./BrandHeader";

interface ShellProps {
  preview: string;
  tag: string;
  tagAccent: string;
  candidateFirstName: string;
  intro: React.ReactNode;
  children?: React.ReactNode;
  cta?: { label: string; url: string };
  footerNote?: React.ReactNode;
}

const Shell = ({
  preview,
  tag,
  tagAccent,
  candidateFirstName,
  intro,
  children,
  cta,
  footerNote,
}: ShellProps) => (
  <Html>
    <Head />
    <Preview>{preview}</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <BrandHeader tag={tag} tagBg={tagAccent} tagColor={BRAND.paper} />

        <Section style={emailStyles.body}>
          <Text style={emailStyles.h1}>
            Hi{" "}
            <span style={{ color: BRAND.pink }}>
              {candidateFirstName || "there"}
            </span>
            ,
          </Text>
          <Text
            style={{
              ...emailStyles.lead,
              fontSize: "15px",
              color: BRAND.text,
              fontWeight: 500,
            }}
          >
            {intro}
          </Text>

          {children}

          {cta && (
            <Section style={{ textAlign: "center", padding: "8px 0 4px 0" }}>
              <Button
                href={cta.url}
                style={{
                  background: BRAND.pink,
                  color: BRAND.paper,
                  padding: "12px 22px",
                  borderRadius: "999px",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "14px",
                  letterSpacing: "0.3px",
                }}
              >
                {cta.label}
              </Button>
              <Text
                style={{
                  fontSize: "12px",
                  color: BRAND.textMuted,
                  marginTop: 12,
                  marginBottom: 0,
                  wordBreak: "break-all",
                }}
              >
                Or paste this link in your browser: {cta.url}
              </Text>
            </Section>
          )}
        </Section>

        <Section style={emailStyles.footer}>
          <Text style={emailStyles.footerBrand}>
            Unicodez Softcorp Private Limited
          </Text>
          <Text
            style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted }}
          >
            {footerNote ?? (
              <>
                Questions? Reach out to HR at{" "}
                <a
                  href="mailto:hr@unicodez.com"
                  style={{ color: BRAND.blue, textDecoration: "none" }}
                >
                  hr@unicodez.com
                </a>
                .
              </>
            )}
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

// ─────────────────────────────────────────────────────────────────────
// Variant 1 — Onboarding form invite

export interface OnboardingInviteProps {
  firstName: string;
  position: string;
  formUrl: string;
  expiresAt: Date;
}

export const OnboardingInviteEmail = ({
  firstName,
  position,
  formUrl,
  expiresAt,
}: OnboardingInviteProps) => (
  <Shell
    preview={`Welcome to Unicodez — complete your onboarding for ${position}`}
    tag="ONBOARDING"
    tagAccent={BRAND.pink}
    candidateFirstName={firstName}
    intro={
      <>
        Welcome to Unicodez! We're excited to begin your onboarding for the{" "}
        <strong>{position}</strong> role. To get started, please complete the
        onboarding form below — it captures your personal details, education,
        and the documents we need before we proceed to the next stage.
      </>
    }
    cta={{ label: "Complete onboarding form", url: formUrl }}
    footerNote={
      <>
        This link is valid until{" "}
        <strong>{expiresAt.toDateString()}</strong>. Need a fresh link? Reach
        out to HR at{" "}
        <a
          href="mailto:hr@unicodez.com"
          style={{ color: BRAND.blue, textDecoration: "none" }}
        >
          hr@unicodez.com
        </a>
        .
      </>
    }
  />
);

// ─────────────────────────────────────────────────────────────────────
// Variant 2 — Info request (free-text from HR)

export interface OnboardingInfoRequestProps {
  firstName: string;
  subject: string;
  body: string;
}

export const OnboardingInfoRequestEmail = ({
  firstName,
  body,
}: OnboardingInfoRequestProps) => (
  <Shell
    preview="HR needs a few more details to proceed"
    tag="ADDITIONAL INFO"
    tagAccent={BRAND.blue}
    candidateFirstName={firstName}
    intro="HR has reviewed your submission and would like a little more information before we proceed:"
  >
    <Section
      style={{
        ...emailStyles.card,
        borderLeft: `3px solid ${BRAND.blue}`,
        background: "#EFF6FF",
        whiteSpace: "pre-wrap" as const,
        fontSize: "14px",
        color: BRAND.text,
        lineHeight: 1.6,
      }}
    >
      {body}
    </Section>
    <Text
      style={{ ...emailStyles.text, fontSize: "13px", color: BRAND.textMuted }}
    >
      Reply directly to this email so the HR team can continue your
      onboarding.
    </Text>
  </Shell>
);

// ─────────────────────────────────────────────────────────────────────
// Variant 3 — Background check started

export interface BgCheckStartedProps {
  firstName: string;
}

export const BgCheckStartedEmail = ({ firstName }: BgCheckStartedProps) => (
  <Shell
    preview="Your background check has been initiated"
    tag="BACKGROUND CHECK"
    tagAccent={BRAND.blue}
    candidateFirstName={firstName}
    intro={
      <>
        We have initiated your background verification. This typically takes
        up to <strong>7 business days</strong> depending on how quickly your
        references respond. You don't need to do anything right now — we'll
        be in touch as soon as it's complete.
      </>
    }
  >
    <Text
      style={{ ...emailStyles.text, fontSize: "13px", color: BRAND.textMuted }}
    >
      If your references need any help, please ask them to reply to the
      verification email they'll receive shortly.
    </Text>
  </Shell>
);

// ─────────────────────────────────────────────────────────────────────
// Variant 4 — Offer letter ready to sign

export interface OfferLetterEmailProps {
  firstName: string;
  position: string;
  signUrl: string;
}

export const OfferLetterEmail = ({
  firstName,
  position,
  signUrl,
}: OfferLetterEmailProps) => (
  <Shell
    preview={`Your offer letter for ${position} is ready to sign`}
    tag="OFFER LETTER"
    tagAccent={BRAND.pink}
    candidateFirstName={firstName}
    intro={
      <>
        Great news — your offer letter for <strong>{position}</strong> is
        ready. Open the link below to review the full letter and sign it
        electronically.
      </>
    }
    cta={{ label: "Review and sign offer", url: signUrl }}
  />
);

// ─────────────────────────────────────────────────────────────────────
// Variant 5 — Offer accepted confirmation

export interface OfferAcceptedEmailProps {
  firstName: string;
  position: string;
  startDate: Date;
}

export const OfferAcceptedEmail = ({
  firstName,
  position,
  startDate,
}: OfferAcceptedEmailProps) => (
  <Shell
    preview="Welcome aboard — we've received your signed offer"
    tag="WELCOME"
    tagAccent={BRAND.success}
    candidateFirstName={firstName}
    intro={
      <>
        Welcome to Unicodez! We've received your signed offer letter for the{" "}
        <strong>{position}</strong> role. We're looking forward to seeing you
        on <strong>{startDate.toDateString()}</strong>.
      </>
    }
  >
    <Text
      style={{ ...emailStyles.text, fontSize: "13px", color: BRAND.textMuted }}
    >
      You'll receive a calendar invite and joining instructions closer to
      your start date.
    </Text>
  </Shell>
);

// ─────────────────────────────────────────────────────────────────────
// Variant 6 — Candidate rejected (any stage)

export interface OnboardingRejectedEmailProps {
  firstName: string;
  position: string;
  reason: string;
  /** Where the rejection happened — informs the empathetic copy.
   *  'bg-check' = background-check failed; anything else = generic
   *  reject (could be at form, after form, or post-BG-pass). */
  variant?: "bg-check" | "generic";
}

export const OnboardingRejectedEmail = ({
  firstName,
  position,
  reason,
  variant = "generic",
}: OnboardingRejectedEmailProps) => (
  <Shell
    preview={`Update on your application for ${position}`}
    tag="APPLICATION UPDATE"
    tagAccent={BRAND.error}
    candidateFirstName={firstName}
    intro={
      variant === "bg-check" ? (
        <>
          Thank you for your patience while we completed background
          verification for the <strong>{position}</strong> role. Unfortunately,
          we're unable to move forward with your application at this time.
        </>
      ) : (
        <>
          Thank you for the time you invested in our process for the{" "}
          <strong>{position}</strong> role. After careful consideration, we've
          decided not to move forward with your application at this time.
        </>
      )
    }
  >
    {/* Reason block — bordered + accent-tinted so it reads as a
        formal explanation rather than a casual aside. */}
    <Section
      style={{
        margin: "16px 0",
        padding: "14px 16px",
        background: `${BRAND.error}0d`,
        border: `1px solid ${BRAND.error}33`,
        borderRadius: "8px",
        borderLeft: `3px solid ${BRAND.error}`,
      }}
    >
      <Text
        style={{
          ...emailStyles.text,
          fontSize: "11px",
          letterSpacing: "1.2px",
          textTransform: "uppercase",
          fontWeight: 700,
          color: BRAND.error,
          margin: "0 0 6px 0",
        }}
      >
        Reason
      </Text>
      <Text
        style={{
          ...emailStyles.text,
          color: BRAND.text,
          margin: 0,
          whiteSpace: "pre-wrap",
        }}
      >
        {reason}
      </Text>
    </Section>
    <Text
      style={{ ...emailStyles.text, fontSize: "13px", color: BRAND.textMuted }}
    >
      We genuinely appreciate the effort you put into engaging with us, and
      we'd be glad to consider your candidacy again for future roles that
      match your skills. If you have any questions about this decision,
      please feel free to reply to this email and our HR team will get
      back to you.
    </Text>
    <Text
      style={{
        ...emailStyles.text,
        fontSize: "13px",
        color: BRAND.textMuted,
        marginTop: "12px",
      }}
    >
      Wishing you the very best in your career ahead.
    </Text>
  </Shell>
);
