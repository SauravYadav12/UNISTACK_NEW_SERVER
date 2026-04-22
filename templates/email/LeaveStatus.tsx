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
import { ILeave } from "../../interface";
import moment from "moment";
import { BRAND, emailStyles } from "./shared-styles";
import BrandHeader from "./BrandHeader";

interface LeaveStatusEmailProps {
  leave: ILeave;
}

export const LeaveStatusEmail = ({ leave }: LeaveStatusEmailProps) => {
  const isApproved = leave.status === "Approved";
  const isRejected = leave.status === "Rejected";
  const accent = isApproved ? BRAND.success : isRejected ? BRAND.error : BRAND.blue;
  const statusText = (leave.status || "UPDATED").toUpperCase();

  const totalDays =
    moment(leave.endDate).diff(moment(leave.startDate), "days") +
    1 -
    (leave.isHalfDay ? 0.5 : 0);
  const dateRange = leave.isHalfDay
    ? `${moment(leave.startDate).format("ddd, DD MMM YYYY")} (${leave.halfDayType})`
    : `${moment(leave.startDate).format("ddd, DD MMM YYYY")} → ${moment(leave.endDate).format("ddd, DD MMM YYYY")}`;

  const heroLine = isApproved
    ? "Your leave request has been approved."
    : isRejected
    ? "Your leave request was not approved."
    : `Your leave request status has been updated to ${leave.status}.`;

  return (
    <Html>
      <Head />
      <Preview>{`Leave ${statusText} · ${moment(leave.startDate).format("DD MMM")} to ${moment(leave.endDate).format("DD MMM YYYY")}`}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <BrandHeader tag={statusText} tagBg={accent} tagColor={BRAND.paper} />

          <Section style={emailStyles.body}>
            <Text style={emailStyles.h1}>
              Hi <span style={{ color: BRAND.pink }}>{leave.name?.split(" ")[0] || "there"}</span>,
            </Text>
            <Text style={{ ...emailStyles.lead, fontSize: "15px", color: BRAND.text, fontWeight: 500 }}>
              {heroLine}
            </Text>

            <Section style={{ ...emailStyles.card, ...(isApproved ? emailStyles.cardAccentPink : emailStyles.cardAccentBlue) }}>
              <table width="100%" cellPadding={0} cellSpacing={0} role="presentation">
                <tbody>
                  <tr>
                    <td width="50%" style={{ paddingRight: 12, verticalAlign: "top" }}>
                      <p style={emailStyles.label}>Leave Type</p>
                      <p style={emailStyles.value}>{leave.type || "—"}</p>
                    </td>
                    <td width="50%" style={{ verticalAlign: "top" }}>
                      <p style={emailStyles.label}>Duration</p>
                      <p style={emailStyles.value}>
                        {totalDays} {totalDays === 1 ? "day" : "days"}
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} style={{ paddingTop: 8 }}>
                      <p style={emailStyles.label}>Dates</p>
                      <p style={emailStyles.value}>{dateRange}</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {isRejected && leave.rejectionReason && (
              <Section
                style={{
                  ...emailStyles.card,
                  borderLeft: `3px solid ${BRAND.error}`,
                  background: "#FEF2F2",
                  border: `1px solid #FECACA`,
                  borderLeftWidth: "3px",
                }}
              >
                <p style={{ ...emailStyles.label, color: BRAND.error }}>Reason for rejection</p>
                <p style={{ ...emailStyles.text, margin: 0, whiteSpace: "pre-wrap" as const }}>
                  {leave.rejectionReason}
                </p>
              </Section>
            )}

            {isApproved && (
              <Text style={{ ...emailStyles.text, fontSize: "13px", color: BRAND.textMuted }}>
                Enjoy your time off — your attendance for the approved dates has been marked automatically.
              </Text>
            )}

            {!isApproved && !isRejected && leave.rejectionReason && (
              <Text style={{ ...emailStyles.text, fontSize: "13px", color: BRAND.textMuted }}>
                Notes: {leave.rejectionReason}
              </Text>
            )}
          </Section>

          <Section style={emailStyles.footer}>
            <Text style={emailStyles.footerBrand}>Unicodez Softcorp Private Limited</Text>
            <Text style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted }}>
              Questions? Reach out to HR at{" "}
              <a href="mailto:hr@unicodez.com" style={{ color: BRAND.blue, textDecoration: "none" }}>
                hr@unicodez.com
              </a>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default LeaveStatusEmail;
