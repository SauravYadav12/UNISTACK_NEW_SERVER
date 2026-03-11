// Shared styles for email templates
export const emailStyles = {
  main: {
    backgroundColor: "#f6f9fc",
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
  },

  container: {
    margin: "0 auto",
    padding: "40px 20px",
    width: "580px",
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
  },

  h1: {
    fontSize: "24px",
    fontWeight: "bold",
    textAlign: "center" as const,
    margin: "30px 0",
    color: "#333",
  },

  text: {
    color: "#4a5568",
    fontSize: "16px",
    lineHeight: "24px",
  },

  detailItem: {
    fontSize: "15px",
    color: "#2d3748",
    margin: "10px 0",
  },

  hr: {
    borderColor: "#e2e8f0",
    margin: "30px 0",
  },

  footer: {
    color: "#8898aa",
    fontSize: "12px",
    textAlign: "center" as const,
  },
};