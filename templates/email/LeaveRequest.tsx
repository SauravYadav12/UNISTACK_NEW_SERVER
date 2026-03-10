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
import moment from "moment";

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
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Leave Request Submitted</Heading>
          <Text style={text}>Hello HR Team,</Text>
          <Text style={text}>
            <strong>{leave.name}</strong> has submitted a new leave request for
            your review.
          </Text>

          <Section style={detailsContainer}>
            <Text style={detailItem}>
              <strong>Type:</strong> {leave.type || "General"}
            </Text>
            <Text style={detailItem}>
              <strong>Duration:</strong> {totalDays}{" "}
              {totalDays > 1 ? "Days" : "Day"} {" - "} {dateRange}
            </Text>
            {leave.reason && (
              <Text style={detailItem}>
                <strong>Reason:</strong> {leave.reason}
              </Text>
            )}
          </Section>

          <Hr style={hr} />
          <Text style={footer}>
            This is an automated notification. Please log in to the HR portal to
            approve or reject this request.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default LeaveRequestEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "20px 0 48px",
  width: "580px",
};

const h1 = {
  color: "#333",
  fontSize: "24px",
  fontWeight: "bold",
  paddingBottom: "16px",
};

const text = {
  color: "#333",
  fontSize: "16px",
  lineHeight: "26px",
};

const detailsContainer = {
  background: "#ffffff",
  borderRadius: "8px",
  padding: "24px",
  border: "1px solid #e6ebf1",
  margin: "20px 0",
};

const detailItem = {
  fontSize: "15px",
  margin: "10px 0",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "20px 0",
};

const footer = {
  color: "#8898aa",
  fontSize: "12px",
};
