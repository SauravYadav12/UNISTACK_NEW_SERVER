// Shared styles for Unicodez email templates.
// Keeping inline values because email clients (Outlook, Gmail web) don't
// reliably honor CSS variables or modern selectors.

export const BRAND = {
  pink: "#EC4599",
  blue: "#37B7EA",
  yellow: "#FCE441",
  navy: "#032840",
  navyLight: "#0A3555",
  paper: "#FFFFFF",
  bg: "#F4F6F8",
  rule: "#E5EBEF",
  text: "#032840",
  textMuted: "#5E7687",
  success: "#10B981",
  error: "#EF4444",
};

export const emailStyles = {
  main: {
    backgroundColor: BRAND.bg,
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    margin: 0,
    padding: "24px 0",
  },

  container: {
    margin: "0 auto",
    width: "600px",
    maxWidth: "100%",
    backgroundColor: BRAND.paper,
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 4px 20px rgba(3, 40, 64, 0.08)",
  },

  headerBand: {
    backgroundColor: BRAND.navy,
    padding: "24px 32px",
    color: BRAND.paper,
  },

  brandRow: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 800,
    letterSpacing: "2px",
    color: BRAND.paper,
  },

  brandSub: {
    margin: "4px 0 0 0",
    fontSize: "11px",
    color: "rgba(255, 255, 255, 0.65)",
    letterSpacing: "0.5px",
  },

  statusTag: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: "4px",
    fontSize: "10px",
    letterSpacing: "2px",
    fontWeight: 700,
    textTransform: "uppercase" as const,
  },

  body: {
    padding: "28px 32px 8px",
  },

  h1: {
    fontSize: "20px",
    fontWeight: 700,
    color: BRAND.text,
    margin: "0 0 8px 0",
    lineHeight: 1.3,
  },

  lead: {
    fontSize: "14px",
    color: BRAND.textMuted,
    margin: "0 0 20px 0",
    lineHeight: 1.6,
  },

  text: {
    color: BRAND.text,
    fontSize: "14px",
    lineHeight: 1.6,
    margin: "8px 0",
  },

  card: {
    background: BRAND.paper,
    borderRadius: "10px",
    padding: "18px 20px",
    border: `1px solid ${BRAND.rule}`,
    margin: "16px 0",
  },

  cardAccentPink: {
    borderLeft: `3px solid ${BRAND.pink}`,
  },

  cardAccentBlue: {
    borderLeft: `3px solid ${BRAND.blue}`,
  },

  label: {
    fontSize: "10px",
    letterSpacing: "1.5px",
    color: BRAND.textMuted,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    margin: "0 0 4px 0",
  },

  value: {
    fontSize: "14px",
    fontWeight: 600,
    color: BRAND.text,
    margin: "0 0 10px 0",
  },

  chip: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: "12px",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.5px",
  },

  detailItem: {
    fontSize: "14px",
    color: BRAND.text,
    margin: "6px 0",
    lineHeight: 1.5,
  },

  hr: {
    borderColor: BRAND.rule,
    borderTop: `1px solid ${BRAND.rule}`,
    margin: "24px 0",
  },

  footer: {
    backgroundColor: "#FAFBFC",
    padding: "18px 32px",
    borderTop: `1px solid ${BRAND.rule}`,
    color: BRAND.textMuted,
    fontSize: "11px",
    lineHeight: 1.6,
  },

  footerBrand: {
    color: BRAND.text,
    fontWeight: 700,
    fontSize: "12px",
    margin: "0 0 4px 0",
  },

  button: {
    display: "inline-block",
    padding: "12px 22px",
    borderRadius: "8px",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: "13px",
    border: "none",
  },

  dotRow: {
    display: "inline-block",
    verticalAlign: "middle",
  },
};
