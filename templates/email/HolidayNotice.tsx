import {
  Body,
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

export interface HolidayNoticeVariables {
  employeeName: string;
  holidayName: string;
  holidayDate: string; // already pretty-printed, e.g. "Monday, 26 January 2026"
  daysUntil: number;
  country: string; // "India" | "United States" | "All offices"
  companyName: string;
  // Pre-substituted strings
  subject: string;
  heading: string;
  bodyLead: string;
  bodyDetails: string;
  signOff: string;
}

// Render a multi-line string as a stack of <Text> nodes so line breaks are
// preserved in the email. Keeps the rendering email-client-safe.
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

export const HolidayNoticeEmail = ({ vars }: { vars: HolidayNoticeVariables }) => {
  const isSoon = vars.daysUntil <= 2;
  const chipBg = isSoon ? BRAND.pink : BRAND.blue;

  return (
    <Html>
      <Head />
      <Preview>{vars.subject}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <BrandHeader
            tag={`IN ${vars.daysUntil} DAY${vars.daysUntil === 1 ? "" : "S"}`}
            tagBg={chipBg}
            tagColor={BRAND.paper}
          />

          <Section style={emailStyles.body}>
            {/* Hero holiday card */}
            <Section
              style={{
                ...emailStyles.card,
                borderLeft: `4px solid ${BRAND.pink}`,
                padding: "20px 22px",
                marginTop: 4,
                marginBottom: 18,
              }}
            >
              <Text
                style={{
                  ...emailStyles.label,
                  color: BRAND.pink,
                  margin: "0 0 4px 0",
                }}
              >
                {vars.country} · UPCOMING HOLIDAY
              </Text>
              <Text
                style={{
                  margin: 0,
                  fontSize: "22px",
                  fontWeight: 800,
                  color: BRAND.navy,
                  lineHeight: 1.2,
                }}
              >
                {vars.holidayName}
              </Text>
              <Text
                style={{
                  margin: "4px 0 0 0",
                  fontSize: "13px",
                  color: BRAND.textMuted,
                }}
              >
                {vars.holidayDate}
              </Text>
            </Section>

            <Text style={emailStyles.h1}>{vars.heading}</Text>

            {renderLines(vars.bodyLead, { ...emailStyles.text, margin: "8px 0" })}
            {renderLines(vars.bodyDetails, {
              ...emailStyles.text,
              color: BRAND.textMuted,
              margin: "8px 0",
            })}

            <Section style={{ marginTop: 18 }}>
              {renderLines(vars.signOff, {
                ...emailStyles.text,
                fontStyle: "italic",
                color: BRAND.textMuted,
                margin: "4px 0",
              })}
            </Section>
          </Section>

          <Section style={emailStyles.footer}>
            <Text style={emailStyles.footerBrand}>{vars.companyName}</Text>
            <Text style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted }}>
              This is an automated reminder. Replies to this address are not monitored.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default HolidayNoticeEmail;
