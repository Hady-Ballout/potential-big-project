import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase";
import { getCallConfig } from "./api";

export type CallState = "connecting" | "connected" | "degraded" | "failed" | "ended";
type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null };

export async function prepareVisitorMedia(cameraId?: string, microphoneId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Media calls are not supported by this browser");
  return navigator.mediaDevices.getUserMedia({
    audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
    video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: "environment" } },
  });
}

export async function prepareResidentAudio(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Media calls are not supported by this browser");
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

export async function mediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return { cameras: [], microphones: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  return { cameras: all.filter(d => d.kind === "videoinput"), microphones: all.filter(d => d.kind === "audioinput") };
}

export class WebRtcCall {
  private pc: RTCPeerConnection | null = null;
  private channel: RealtimeChannel | null = null;
  private realtimeClient: SupabaseClient;
  private makingOffer = false;
  private ignoreOffer = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private restartAttempted = false;
  private remoteReady = false;
  private closed = false;
  private timeout?: number;
  private maxDuration?: number;

  constructor(
    private accessToken: string,
    private visitId: string,
    private role: "visitor" | "resident",
    private local: MediaStream,
    private onRemote: (stream: MediaStream) => void,
    private onState: (state: CallState, degraded?: boolean) => void,
  ) {
    // A call owns its Realtime auth so visitor and resident tabs cannot overwrite each other's JWT.
    this.realtimeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async connect() {
    const config = await getCallConfig(this.accessToken, this.visitId);
    if (config.role !== this.role) throw new Error("Call role did not match");
    this.onState("connecting", config.degraded);
    this.pc = new RTCPeerConnection({ iceServers: config.ice_servers });
    this.local.getTracks().forEach(track => this.pc!.addTrack(track, this.local));
    this.pc.ontrack = event => this.onRemote(event.streams[0] ?? new MediaStream([event.track]));
    this.pc.onicecandidate = event => void this.send({ candidate: event.candidate?.toJSON() ?? null });
    this.pc.onnegotiationneeded = async () => {
      if (this.role !== "visitor" || !this.remoteReady) return;
      try {
        this.makingOffer = true;
        await this.pc!.setLocalDescription();
        await this.send({ description: this.pc!.localDescription! });
      } finally { this.makingOffer = false; }
    };
    this.pc.onconnectionstatechange = () => this.connectionChanged();
    await this.realtimeClient.realtime.setAuth(this.accessToken);
    this.channel = this.realtimeClient.channel(config.topic, { config: { private: true, broadcast: { self: false } } })
      .on("broadcast", { event: "signal" }, ({ payload }) => void this.receive(payload as Signal))
      .on("broadcast", { event: "ready" }, () => void this.peerReady())
      .on("broadcast", { event: "hangup" }, () => this.close(false));
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Signaling channel timed out")), 10_000);
      this.channel!.subscribe(status => {
        if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error("Signaling channel failed")); }
      });
    });
    await this.channel.send({ type: "broadcast", event: "ready", payload: { role: this.role } });
    this.timeout = window.setTimeout(() => {
      if (this.pc?.connectionState !== "connected") this.onState("failed", config.degraded);
    }, 20_000);
    this.maxDuration = window.setTimeout(() => this.close(true), 5 * 60_000);
  }

  private async peerReady() {
    if (!this.channel || !this.pc) return;
    if (this.role === "resident") {
      await this.channel.send({ type: "broadcast", event: "ready", payload: { role: this.role } });
      return;
    }
    if (this.remoteReady) return;
    this.remoteReady = true;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this.send({ description: this.pc.localDescription! });
    } finally { this.makingOffer = false; }
  }

  private async receive(signal: Signal) {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (signal.description) {
        const offerCollision = signal.description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
        this.ignoreOffer = this.role === "visitor" && offerCollision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(signal.description);
        for (const candidate of this.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
        if (signal.description.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          await this.send({ description: pc.localDescription! });
        }
      } else if (signal.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else this.pendingCandidates.push(signal.candidate);
      }
    } catch (e) { if (!this.ignoreOffer) { console.error("WebRTC signaling failed", e); this.onState("failed"); } }
  }

  private async send(payload: Signal) {
    if (!this.channel) return;
    await this.channel.send({ type: "broadcast", event: "signal", payload });
  }

  private connectionChanged() {
    const state = this.pc?.connectionState;
    if (state === "connected") {
      if (this.timeout) clearTimeout(this.timeout);
      this.onState("connected");
    } else if (state === "disconnected" && !this.restartAttempted) {
      this.restartAttempted = true;
      this.onState("degraded");
      this.pc?.restartIce();
    } else if (state === "failed") this.onState("failed");
    else if (state === "closed") this.onState("ended");
  }

  setMuted(muted: boolean) { this.local.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  setCamera(enabled: boolean) { this.local.getVideoTracks().forEach(track => { track.enabled = enabled; }); }

  async close(notify = true) {
    if (this.closed) return;
    this.closed = true;
    if (notify && this.channel) await this.channel.send({ type: "broadcast", event: "hangup", payload: {} }).catch(() => undefined);
    if (this.timeout) clearTimeout(this.timeout);
    if (this.maxDuration) clearTimeout(this.maxDuration);
    this.pc?.close();
    this.pc = null;
    if (this.channel) await this.realtimeClient.removeChannel(this.channel);
    this.channel = null;
    this.local.getTracks().forEach(track => track.stop());
    this.onState("ended");
  }
}
