import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareResidentAudio, prepareVisitorMedia, WebRtcCall } from "./webrtc";

const originalNavigator = globalThis.navigator;
afterEach(() => Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true }));

describe("media preparation", () => {
  it("prefers the visitor rear camera and requests audio", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia } }, configurable: true });
    await expect(prepareVisitorMedia()).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: { facingMode: { ideal: "environment" } } });
  });

  it("uses explicitly selected devices", async () => {
    const getUserMedia = vi.fn().mockResolvedValue({});
    Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia } }, configurable: true });
    await prepareVisitorMedia("camera-2", "mic-2");
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: "mic-2" } }, video: { deviceId: { exact: "camera-2" } },
    });
  });

  it("resident requests audio without a camera", async () => {
    const getUserMedia = vi.fn().mockResolvedValue({});
    Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia } }, configurable: true });
    await prepareResidentAudio();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  });
});

it("call teardown is repeat-safe and stops every local track", async () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;
  const states: string[] = [];
  const call = new WebRtcCall("token", "visit", "visitor", stream, () => undefined, state => states.push(state));
  await call.close(false);
  await call.close(false);
  expect(stop).toHaveBeenCalledTimes(2);
  expect(states).toEqual(["ended"]);
});
