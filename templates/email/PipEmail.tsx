/**
 * PIP email — renders the reviewer-authored letter body inside the shared
 * branded shell. Used for both the initiation notice and the
 * PIP-failed/termination outcome. The subject is passed to sendMail
 * separately; `body` is exactly what the reviewer saw/edited in the wizard.
 *
 * The body is stored as plain text (blank-line-separated paragraphs, with
 * "• …" lines for the concern list). Email clients (Gmail, Outlook) collapse
 * newlines and ignore `white-space: pre-wrap` on <p>, so instead of dumping
 * the raw string we parse it into REAL block elements — <p> paragraphs and a
 * proper <ul> — which every client renders with correct spacing and bullets.
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

type Block =
  | { type: "p"; lines: string[] }
  | { type: "ul"; items: string[] };

// A line is a bullet when (after indentation) it starts with •, -, or *.
const BULLET_RE = /^\s*[••\-*]\s+/;

/**
 * Turn the plain-text letter into ordered blocks: blank lines break
 * paragraphs, consecutive "• …" lines group into a single list, and
 * adjacent non-bullet lines (e.g. the sign-off) stay together with <br/>.
 */
function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", lines: para });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: "ul", items: list });
      list = [];
    }
  };

  for (const raw of (body || "").split("\n")) {
    if (!raw.trim()) {
      flushList();
      flushPara();
      continue;
    }
    if (BULLET_RE.test(raw)) {
      flushPara();
      list.push(raw.replace(BULLET_RE, "").trim());
    } else {
      flushList();
      para.push(raw.trim());
    }
  }
  flushList();
  flushPara();
  return blocks;
}

const paraStyle: React.CSSProperties = {
  ...emailStyles.text,
  color: BRAND.text,
  fontSize: "14px",
  lineHeight: 1.7,
  margin: "0 0 14px 0",
};

const listStyle: React.CSSProperties = {
  margin: "0 0 14px 0",
  paddingLeft: "22px",
};

const listItemStyle: React.CSSProperties = {
  color: BRAND.text,
  fontSize: "14px",
  lineHeight: 1.6,
  margin: "6px 0",
};

export const PipEmail = ({ employeeName, body }: PipEmailProps) => {
  const blocks = parseBody(body);
  return (
    <Html>
      <Head />
      <Preview>
        Performance Improvement Plan — {employeeName || "Employee"}
      </Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <BrandHeader
            tag="PERFORMANCE IMPROVEMENT PLAN"
            tagBg={BRAND.error}
            tagColor={BRAND.paper}
          />
          <Section style={emailStyles.body}>
            {blocks.map((block, i) =>
              block.type === "ul" ? (
                <ul key={i} style={listStyle}>
                  {block.items.map((item, j) => (
                    <li key={j} style={listItemStyle}>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <Text key={i} style={paraStyle}>
                  {block.lines.map((line, j) => (
                    <React.Fragment key={j}>
                      {j > 0 && <br />}
                      {line}
                    </React.Fragment>
                  ))}
                </Text>
              )
            )}
          </Section>
          <Section style={emailStyles.footer}>
            <Text style={emailStyles.footerBrand}>
              Unicodez Softcorp Private Limited
            </Text>
            <Text
              style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted }}
            >
              This is a formal HR communication. For any questions, reply to
              this email to reach the HR team.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};
