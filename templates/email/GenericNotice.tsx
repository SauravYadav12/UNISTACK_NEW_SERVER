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

/**
 * Single reusable email layout driven by pre-substituted strings. Used by
 * invoice-raised / invoice-due / timesheet-approval-request emails so every
 * admin-editable template renders through the same shell. The layout is
 * deliberately generic; per-template tone is carried by the tagline + chip
 * color.
 */
export interface GenericNoticeVariables {
  subject: string;
  heading: string;
  bodyLead: string;
  bodyDetails: string;
  signOff: string;
  /** Short tagline that appears in the brand header chip. */
  tag: string;
  /** Brand tag background color. Defaults to pink. */
  tagBg?: string;
  /** Optional call-to-action — when set, a button renders below the body
   *  details. Use for "Review in app" / "Open invoice" style deep-links. */
  ctaLabel?: string;
  ctaUrl?: string;
}

function renderLines(text: string, style: React.CSSProperties) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((line, i) => (
      <Text key={i} style={style}>
        {line}
      </Text>
    ));
}

export const GenericNoticeEmail = ({
  vars,
}: {
  vars: GenericNoticeVariables;
}) => {
  return (
    <Html>
      <Head />
      <Preview>{vars.subject}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <BrandHeader
            tag={vars.tag}
            tagBg={vars.tagBg ?? BRAND.pink}
            tagColor={BRAND.paper}
          />

          <Section style={{ padding: "24px 32px" }}>
            <Text
              style={{
                margin: "0 0 12px",
                fontSize: "20px",
                fontWeight: 700,
                color: BRAND.text,
                lineHeight: 1.3,
              }}
            >
              {vars.heading}
            </Text>

            {renderLines(vars.bodyLead, {
              margin: "0 0 12px",
              fontSize: "14px",
              color: BRAND.text,
              lineHeight: 1.55,
            })}

            {renderLines(vars.bodyDetails, {
              margin: "0 0 12px",
              fontSize: "13px",
              color: BRAND.textMuted,
              lineHeight: 1.55,
            })}

            {vars.ctaLabel && vars.ctaUrl && (
              <Section style={{ marginTop: "20px", marginBottom: "4px" }}>
                <Button
                  href={vars.ctaUrl}
                  style={{
                    backgroundColor: BRAND.pink,
                    color: BRAND.paper,
                    padding: "12px 22px",
                    borderRadius: "10px",
                    fontWeight: 700,
                    fontSize: "13.5px",
                    textDecoration: "none",
                    display: "inline-block",
                    letterSpacing: "0.02em",
                  }}
                >
                  {vars.ctaLabel}
                </Button>
              </Section>
            )}

            <Section
              style={{
                borderTop: `1px solid ${BRAND.rule}`,
                marginTop: "20px",
                paddingTop: "16px",
              }}
            >
              {renderLines(vars.signOff, {
                margin: "0 0 4px",
                fontSize: "13px",
                color: BRAND.textMuted,
              })}
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default GenericNoticeEmail;
