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
      <Body style={main}>
        <Container style={container}>
          <Heading style={{ ...h1, color: statusColor }}>
            Leave Request {leave.status}
          </Heading>
          
          <Text style={text}>Hi {leave.name},</Text>
          <Text style={text}>
            Your request for <strong>{leave.type || 'Leave'}</strong> from 
            <strong> {leave.startDate}</strong> to <strong>{leave.endDate}</strong> has been 
            <span style={{ color: statusColor, fontWeight: "bold" }}> {leave.status?.toLowerCase() || 'N/A'}</span>.
          </Text>

          {!isApproved && leave.rejectionReason && (
            <Section style={reasonBox}>
              <Text style={{ ...detailItem, marginBottom: "4px" }}><strong>Reason for Rejection:</strong></Text>
              <Text style={detailItem}>{leave.rejectionReason}</Text>
            </Section>
          )}

          <Hr style={hr} />
          
          <Text style={footer}>
            If you have any questions regarding this decision, please contact your HR representative.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default LeaveStatusEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "40px 20px",
  width: "580px",
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
};

const h1 = {
  fontSize: "22px",
  fontWeight: "bold",
  textAlign: "center" as const,
  margin: "30px 0",
};

const text = {
  color: "#4a5568",
  fontSize: "16px",
  lineHeight: "24px",
};

const reasonBox = {
  background: "#fff5f5",
  borderRadius: "6px",
  padding: "16px",
  border: "1px solid #feb2b2",
  marginTop: "20px",
};

const detailItem = {
  fontSize: "15px",
  color: "#2d3748",
  margin: "0",
};

const hr = {
  borderColor: "#e2e8f0",
  margin: "30px 0",
};

const footer = {
  color: "#a0aec0",
  fontSize: "12px",
  textAlign: "center" as const,
};
