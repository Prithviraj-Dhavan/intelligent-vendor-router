// mockResponses.js
// Generates a plausible, capability-specific mock response so the platform
// can be demoed end-to-end without real third-party credentials. Swap
// simulateVendorCall() in engine.js for a real HTTP call to go live.

function generateMockResponse(capability, payload) {
  switch (capability) {
    case "PAN_VERIFICATION":
      return {
        panStatus: "VALID",
        nameMatch: true,
        panNumber: payload?.pan || "UNKNOWN",
        nameOnRecord: payload?.name || "N/A",
      };
    case "KYC":
      return {
        kycStatus: "VERIFIED",
        matchScore: 0.94,
        documentType: payload?.documentType || "AADHAAR",
      };
    case "OCR":
      return {
        extractedText: "Sample extracted text from document.",
        confidence: 0.97,
        fields: { name: payload?.name || "N/A", docNumber: "XXXX-1234" },
      };
    case "SMS":
      return {
        messageId: `msg_${Math.random().toString(36).slice(2, 10)}`,
        deliveryStatus: "SENT",
        recipient: payload?.phone || "N/A",
      };
    case "PAYMENT":
      return {
        transactionId: `txn_${Math.random().toString(36).slice(2, 10)}`,
        paymentStatus: "CONFIRMED",
        amount: payload?.amount || 0,
      };
    default:
      return {
        message: `Mock response for capability '${capability}'`,
        received: payload || {},
      };
  }
}

module.exports = { generateMockResponse };
