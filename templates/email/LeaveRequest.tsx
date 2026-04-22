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
import { ILeave } from "../../interface";
import moment from "moment";
import { BRAND, emailStyles } from "./shared-styles";
import BrandHeader from "./BrandHeader";
import ENV_VARS from "../../config/env.config";

interface LeaveEmailProps {
  leave: ILeave;
}

export const LeaveRequestEmail = ({ leave }: LeaveEmailProps) => {
  const totalDays =
    moment(leave.endDate).diff(moment(leave.startDate), "days") +
    1 -
    (leave.isHalfDay ? 0.5 : 0);
  const dateRange = leave.isHalfDay
    ? `${moment(leave.startDate).format("ddd, DD MMM YYYY")} (${leave.halfDayType})`
    : `${moment(leave.startDate).format("ddd, DD MMM YYYY")} → ${moment(leave.endDate).format("ddd, DD MMM YYYY")}`;

  const link = `${ENV_VARS.FRONTEND_URL}/leaves-management?id=${leave._id.toString()}`;

  return (
    <Html>
      <Head />
      <Preview>{`Leave request from ${leave.name} — ${totalDays} day${totalDays > 1 ? "s" : ""}`}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <BrandHeader tag="NEW LEAVE REQUEST" tagBg={BRAND.pink} tagColor={BRAND.paper} />

          <Section style={emailStyles.body}>
            <Text style={emailStyles.h1}>
              <span style={{ color: BRAND.pink }}>{leave.name}</span> has requested time off
            </Text>
            <Text style={emailStyles.lead}>
              Review the details below and approve or reject directly from the HR portal.
            </Text>

            <Section style={{ ...emailStyles.card, ...emailStyles.cardAccentPink }}>
              <table width="100%" cellPadding={0} cellSpacing={0} role="presentation">
                <tbody>
                  <tr>
                    <td width="50%" style={{ paddingRight: 12, verticalAlign: "top" }}>
                      <p style={emailStyles.label}>Leave Type</p>
                      <p style={emailStyles.value}>{leave.type || "—"}</p>
                    </td>
                    <td width="50%" style={{ verticalAlign: "top" }}>
                      <p style={emailStyles.label}>Duration</p>
                      <p style={{ ...emailStyles.value, color: BRAND.pink }}>
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
                  {leave.reason && (
                    <tr>
                      <td colSpan={2} style={{ paddingTop: 8 }}>
                        <p style={emailStyles.label}>Reason</p>
                        <p style={{ ...emailStyles.text, whiteSpace: "pre-wrap" as const, margin: 0 }}>
                          {leave.reason}
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Section>

            <Section style={{ textAlign: "center" as const, margin: "24px 0 8px 0" }}>
              <Button
                href={link}
                style={{
                  ...emailStyles.button,
                  backgroundColor: BRAND.success,
                  color: BRAND.paper,
                  marginRight: "8px",
                }}
              >
                Approve
              </Button>
              <Button
                href={link}
                style={{
                  ...emailStyles.button,
                  backgroundColor: BRAND.error,
                  color: BRAND.paper,
                  marginLeft: "8px",
                }}
              >
                Reject
              </Button>
            </Section>

            <Text style={{ ...emailStyles.text, color: BRAND.textMuted, fontSize: "12px", textAlign: "center" as const }}>
              Or review the full request in the portal.
            </Text>
          </Section>

          <Section style={emailStyles.footer}>
            <Text style={emailStyles.footerBrand}>Unicodez Softcorp Private Limited</Text>
            <Text style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted }}>
              This is an automated notification. Please do not reply directly to this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default LeaveRequestEmail;
