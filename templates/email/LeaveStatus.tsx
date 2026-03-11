import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { ILeave } from "../../interface";
import { emailStyles } from "./shared-styles";

interface LeaveStatusEmailProps {
  leave: ILeave;
}

export const LeaveStatusEmail = ({ leave }: LeaveStatusEmailProps) => {
  const isApproved = leave.status === 'Approved';
  const statusColor = isApproved ? "#10b981" : "#ef4444";

  return (
    <Html>
      <Head />
      <Preview>Leave Request {leave.status||'N/A'}: {leave.startDate}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Heading style={{ ...emailStyles.h1, color: statusColor }}>
            Leave Request {leave.status}
          </Heading>
          
          <Text style={emailStyles.text}>Hi {leave.name},</Text>
          <Text style={emailStyles.text}>
            Your request for <strong>{leave.type || 'Leave'}</strong> from 
            <strong> {leave.startDate}</strong> to <strong>{leave.endDate}</strong> has been 
            <span style={{ color: statusColor, fontWeight: "bold" }}> {leave.status?.toLowerCase() || 'N/A'}</span>.
          </Text>

          {!isApproved && leave.rejectionReason && (
            <Section style={reasonBox}>
              <Text style={{ ...emailStyles.detailItem, marginBottom: "4px" }}><strong>Reason for Rejection:</strong></Text>
              <Text style={emailStyles.detailItem}>{leave.rejectionReason}</Text>
            </Section>
          )}

          <Hr style={emailStyles.hr} />
          
          <Text style={emailStyles.footer}>
            If you have any questions regarding this decision, please contact your HR representative.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default LeaveStatusEmail;

// Component-specific styles
const reasonBox = {
  background: "#fff5f5",
  borderRadius: "6px",
  padding: "16px",
  border: "1px solid #feb2b2",
  marginTop: "20px",
};
