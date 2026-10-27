import { describe, it, expect } from "vitest";
import { normalizePaymentMethod } from "../server.js";

describe("normalizePaymentMethod", () => {
  it("should return USDT for undefined method", () => {
    const result = normalizePaymentMethod(undefined);
    expect(result).toBe("USDT");
  });

  it("should return USDT for empty string method", () => {
    const result = normalizePaymentMethod("");
    expect(result).toBe("USDT");
  });

  it("should return USDT for null method", () => {
    const result = normalizePaymentMethod(null);
    expect(result).toBe("USDT");
  });

  it("should return Paystack for paystack method", () => {
    const result = normalizePaymentMethod("paystack");
    expect(result).toBe("Paystack");
  });

  it("should return USDT for usdt method", () => {
    const result = normalizePaymentMethod("USDT");
    expect(result).toBe("USDT");
  });

  it("should return Bitcoin for bitcoin method", () => {
    const result = normalizePaymentMethod("bitcoin");
    expect(result).toBe("Bitcoin");
  });

  it("should return Crypto for crypto method", () => {
    const result = normalizePaymentMethod("crypto");
    expect(result).toBe("Crypto");
  });
});