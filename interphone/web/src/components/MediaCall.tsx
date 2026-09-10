import { useEffect, useRef, useState } from "react";
import { WebRtcCall, type CallState } from "../lib/webrtc";
import { Button, Feedback } from "./ui";

export default function MediaCall({ accessToken, visitId, role, localStream, onEnded }: {
  accessToken: string; visitId: string; role: "visitor" | "resident"; localStream: MediaStream; onEnded?: () => void;
}) {
  const call = useRef<WebRtcCall | null>(null);
  const remoteElement = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CallState>("connecting");
  const [degraded, setDegraded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(true);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [failureDetail, setFailureDetail] = useState("");

  useEffect(() => {
    let disposed = false;
    const instance = new WebRtcCall(accessToken, visitId, role, localStream, stream => {
      if (!remoteElement.current) return;
      if (remoteElement.current.srcObject === stream) return;
      remoteElement.current.srcObject = stream;
      void remoteElement.current.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    }, (next, turnDegraded, detail) => {
      if (disposed) return;
      setState(next);
      if (turnDegraded !== undefined) setDegraded(turnDegraded);
      if (detail) setFailureDetail(detail);
    });
    call.current = instance;
    void instance.connect().catch(e => { console.error("Call setup failed", e); if (!disposed) setState("failed"); });
    return () => { disposed = true; call.current = null; void instance.close(false); };
  }, [accessToken, visitId, role, localStream]);
  useEffect(() => { if (state === "ended") onEnded?.(); }, [state, onEnded]);

  const label = state === "connected" ? "Call connected" : state === "connecting" ? "Connecting call…"
    : state === "degraded" ? "Connection interrupted. Reconnecting…" : state === "failed" ? "Video call unavailable" : "Call ended";

  return <section className="media-call" aria-label="Door call">
    <video ref={remoteElement} className={`call-video ${role === "visitor" ? "audio-only" : ""}`} autoPlay playsInline aria-label={role === "resident" ? "Visitor video" : "Resident audio"} />
    <p className="call-status" role="status">{label}</p>
    {degraded && <Feedback tone="warn">TURN is unavailable. Trying a direct connection; entry controls still work.</Feedback>}
    {state === "failed" && <Feedback tone="warn">{failureDetail || "Continue without media. You can still use the entry controls."}</Feedback>}
    {needsPlay && <Button variant="primary" onClick={() => void remoteElement.current?.play().then(() => setNeedsPlay(false))}>Tap to hear</Button>}
    <div className="call-controls">
      <Button aria-pressed={muted} onClick={() => { const next = !muted; setMuted(next); call.current?.setMuted(next); }}>{muted ? "Unmute microphone" : "Mute microphone"}</Button>
      {role === "visitor" && <Button aria-pressed={!camera} onClick={() => { const next = !camera; setCamera(next); call.current?.setCamera(next); }}>{camera ? "Turn camera off" : "Turn camera on"}</Button>}
      <Button variant="quiet" onClick={() => void call.current?.close(true)}>Hang up</Button>
    </div>
  </section>;
}
