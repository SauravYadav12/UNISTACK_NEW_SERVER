/**
 * PIP email — renders the reviewer-authored letter body verbatim (pre-wrap)
 * inside the shared branded shell. Used for both the initiation notice and
 * the PIP-failed/termination outcome. The subject is passed to sendMail
 * separately; `body` is exactly what the reviewer saw in the wizard.
 */
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

export interface PipEmailProps {
  employeeName: string;
  body: string;
}

export const PipEmail = ({ employeeName, body }: PipEmailProps) => (
  <Html>
    <Head />
    <Preview>Performance Improvement Plan — {employeeName || "Employee"}</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <BrandHeader
          tag="PERFORMANCE IMPROVEMENT PLAN"
          tagBg={BRAND.error}
          tagColor={BRAND.paper}
        />
        <Section style={emailStyles.body}>
          <Text
            style={{
              ...emailStyles.text,
              color: BRAND.text,
              whiteSpace: "pre-wrap" as const,
              fontSize: "14px",
              lineHeight: 1.7,
            }}
          >
            {body}
          </Text>
        </Section>
        <Section style={emailStyles.footer}>
          <Text style={emailStyles.footerBrand}>
            Unicodez Softcorp Private Limited
          </Text>
          <Text style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted }}>
            This is a formal HR communication. For any questions, reply to this
            email to reach the HR team.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);
