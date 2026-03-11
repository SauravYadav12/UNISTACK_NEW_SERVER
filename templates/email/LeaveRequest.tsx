import {
  Body,
  Button,
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
import moment from "moment";
import { emailStyles } from "./shared-styles";
import ENV_VARS from "../../config/env.config";

interface LeaveEmailProps {
  leave: ILeave;
}

export const LeaveRequestEmail = ({ leave }: LeaveEmailProps) => {
  const dateRange = leave.isHalfDay
    ? `${leave.startDate} (${leave.halfDayType})`
    : `${leave.startDate} to ${leave.endDate}`;
  const totalDays =
    moment(leave.endDate).diff(moment(leave.startDate), "days") + 1;
  return (
    <Html>
      <Head />
      <Preview>New Leave Request from {leave.name}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Heading style={emailStyles.h1}>Leave Request</Heading>
          <Text style={emailStyles.text}>Hello HR Team,</Text>
          <Text style={emailStyles.text}>
            <strong>{leave.name}</strong> has submitted a new leave request for
            your review.
          </Text>

          <Section style={detailsContainer}>
            <Text style={emailStyles.detailItem}>
              <strong>Type:</strong> {leave.type || "General"}
            </Text>
            <Text style={emailStyles.detailItem}>
              <strong>Duration:</strong> {totalDays}{" "}
              {totalDays > 1 ? "Days" : "Day"} {" - "} {dateRange}
            </Text>
            {leave.reason && (
              <Text
                style={{
                  ...emailStyles.detailItem,
                  whiteSpace: "pre-wrap" as const,
                }}
              >
                <strong>Reason:</strong> {leave.reason}
              </Text>
            )}
          </Section>

          <Section style={buttonContainer}>
            <Button
              style={approveButton}
              href={`${ENV_VARS.FRONTEND_URL}/leaves-management?id=${leave._id.toString()}`}
            >
              Approve
            </Button>
            <Button
              style={rejectButton}
              href={`${ENV_VARS.FRONTEND_URL}/leaves-management?id=${leave._id.toString()}`}
            >
              Reject
            </Button>
          </Section>

          <Hr style={emailStyles.hr} />
          <Text style={emailStyles.footer}>
            This is an automated notification. Please log in to the HR portal to
            approve or reject this request.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default LeaveRequestEmail;

// Component-specific styles
const detailsContainer = {
  background: "#ffffff",
  borderRadius: "8px",
  padding: "24px",
  border: "1px solid #e6ebf1",
  margin: "20px 0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "30px 0",
};

const approveButton = {
  backgroundColor: "#10b981",
  color: "#ffffff",
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  fontWeight: "bold",
  fontSize: "14px",
  marginRight: "10px",
  display: "inline-block",
  border: "none",
};

const rejectButton = {
  backgroundColor: "#ef4444",
  color: "#ffffff",
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  fontWeight: "bold",
  fontSize: "14px",
  marginLeft: "10px",
  display: "inline-block",
  border: "none",
};
