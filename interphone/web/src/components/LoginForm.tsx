import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setPending(false);
  }

  return (
    <div className="page">
      <div className="header"><h1>Interphone</h1></div>
      <form className="card form" onSubmit={(e) => void submit(e)}>
        <h2>Resident login</h2>
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="flash error">{error}</div>}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </button>
        {import.meta.env.DEV && (
          <p className="subtle">Demo: demo@interphone.local / demo1234 (apartment 1A)</p>
        )}
      </form>
    </div>
  );
}
