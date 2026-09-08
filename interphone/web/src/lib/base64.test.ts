import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./base64";

describe("urlBase64ToUint8Array", () => {
  it("decodes URL-safe base64 without padding", () => {
    // "hello?>" in url-safe base64 is aGVsbG8_Pg
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8_Pg"))).toEqual([104, 101, 108, 108, 111, 63, 62]);
  });
  it("decodes a VAPID-sized key to 65 bytes", () => {
    const key = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
    expect(urlBase64ToUint8Array(key).length).toBe(65);
  });
});
