import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { copy } from "../lib/copy";
import { Button, Feedback, Field, Icon, Page } from "./ui";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        console.error("Sign-in failed", authError);
        setError(authError.code === "invalid_credentials" ? copy.login.invalid
          : authError.code === "email_not_confirmed" ? copy.login.unconfirmed
          : authError.status === 429 ? copy.login.limited
          : authError.status === 0 ? copy.network : copy.login.failed);
      }
    } catch (e) {
      console.error("Sign-in connection failed", e);
      setError(copy.network);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <Page context={copy.login.eyebrow}>
    <div className="page-heading"><p className="eyebrow">{copy.login.eyebrow}</p><h1>{copy.login.title}</h1><p className="subtle">{copy.login.detail}</p></div>
    <form className="panel stack" onSubmit={(e) => void submit(e)} aria-busy={pending}>
      <Field id="email" label={copy.login.email}><input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={pending} aria-describedby={error ? "login-error" : undefined} /></Field>
      <Field id="password" label={copy.login.password}><div className="password-control">
        <input id="password" type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={pending} aria-describedby={error ? "login-error" : undefined} />
        <button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? copy.login.hidePassword : copy.login.showPassword} aria-pressed={visible}>{visible ? copy.login.hide : copy.login.show}</button>
      </div></Field>
      {error && <div id="login-error"><Feedback tone="error">{error}</Feedback></div>}
      <Button variant="primary" type="submit" disabled={pending}>{pending ? copy.login.pending : copy.login.submit}<Icon name="arrow" /></Button>
    </form>
    <p className="subtle form-help">{copy.login.help}</p>
  </Page>;
}
