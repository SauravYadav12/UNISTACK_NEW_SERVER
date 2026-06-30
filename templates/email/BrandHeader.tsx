import { Section } from "@react-email/components";
import * as React from "react";
import { BRAND, emailStyles } from "./shared-styles";

interface Props {
  tag?: string; // "NEW REQUEST", "APPROVED", "REJECTED", etc.
  tagBg?: string;
  tagColor?: string;
}

// A compact header band reused across Unicodez emails.
// The logo is three dots (pink/blue/yellow) next to the company mark —
// matches the Unicodez branding while staying email-safe (no SVGs).
export const BrandHeader = ({ tag, tagBg, tagColor }: Props) => (
  <Section style={emailStyles.headerBand}>
    <table width="100%" cellPadding={0} cellSpacing={0} role="presentation">
      <tbody>
        <tr>
          <td>
            <table cellPadding={0} cellSpacing={0} role="presentation" style={{ display: "inline-block", verticalAlign: "middle" }}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: BRAND.pink }} />
                  </td>
                  <td style={{ paddingRight: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: BRAND.blue }} />
                  </td>
                  <td style={{ paddingRight: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: BRAND.yellow }} />
                  </td>
                  <td>
                    <div>
                      <p style={emailStyles.brandRow}>UNICODEZ</p>
                      <p style={emailStyles.brandSub}>INC</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
          {tag && (
            <td align="right" style={{ verticalAlign: "middle" }}>
              <span
                style={{
                  ...emailStyles.statusTag,
                  backgroundColor: tagBg || BRAND.pink,
                  color: tagColor || BRAND.paper,
                }}
              >
                {tag}
              </span>
            </td>
          )}
        </tr>
      </tbody>
    </table>
  </Section>
);

export default BrandHeader;
