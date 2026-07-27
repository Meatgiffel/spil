import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../api.js";
import { Field } from "../components.js";
import { fetchAuthStatus, signIn, signUp } from "../auth-client.js";
import { sync } from "../db/sync.js";
import { translateError, useT } from "../i18n/index.js";
import { useSession } from "../session.js";

type Mode = "login" | "signup" | "setup";

export function LoginScreen() {
  const { setUser } = useSession();
  const t = useT();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteKey, setInviteKey] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Er installationen tom, er der ingen at logge ind som — så vis opsætningen.
    void fetchAuthStatus()
      .then((status) => setMode(status.needsSetup ? "setup" : "login"))
      .catch(() => {
        /* offline: bliv på login, den cachede session kan stadig gælde */
      });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFields({});
    setMessage(null);
    try {
      const user =
        mode === "login"
          ? await signIn(email, password)
          : await signUp({
              email,
              name,
              password,
              ...(mode === "signup" ? { inviteKey } : {}),
            });

      // Vent på første synkronisering før app'en lukkes op.
      //
      // Ens egen spiller-række oprettes på serveren ved signup og kommer først
      // med i pull. Uden ventetiden kan man nå at gå offline før den er hentet,
      // og så står man i sin egen gruppe uden at kunne vælge sig selv som
      // deltager. Offline-first begynder først efter den ene synkronisering.
      await sync();
      setUser(user);
    } catch (error) {
      if (error instanceof ApiError) {
        // Brugerens indtastning bevares — felterne ryddes aldrig ved fejl.
        // Serveren sender koder; teksten er kun fallback for ukendte koder.
        setFields(
          Object.fromEntries(
            Object.entries(error.fields ?? {}).map(([field, code]) => [
              field,
              translateError(t, code, code),
            ]),
          ),
        );
        setMessage(error.fields ? null : translateError(t, error.code, error.message));
      } else {
        setMessage(t("errors.unknown"));
      }
    } finally {
      setBusy(false);
    }
  }

  const isSetup = mode === "setup";
  const isLogin = mode === "login";

  return (
    <main className="screen">
      <header className="screen-head">
        <div className="screen-head-row">
          <span className="screen-title">{t("app.name")}</span>
          <span className="kicker">
            {isSetup
              ? t("login.setupTitle")
              : isLogin
                ? t("login.title")
                : t("login.signUpTitle")}
          </span>
        </div>
      </header>

      <form className="screen-body" onSubmit={submit} noValidate>
        {isSetup && (
          <div className="stack-tight">
            <h1>{t("login.setupHeading")}</h1>
            <p className="lede">{t("login.setupLede")}</p>
          </div>
        )}

        {!isSetup && <h1>{isLogin ? t("login.title") : t("login.signUpTitle")}</h1>}

        <Field label={t("login.email")} error={fields.email}>
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            value={email}
            aria-invalid={Boolean(fields.email)}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        {!isLogin && (
          <Field label={t("login.name")} error={fields.name}>
            <input
              className="input"
              autoComplete="name"
              required
              value={name}
              aria-invalid={Boolean(fields.name)}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        )}

        <Field label={t("login.password")} error={fields.password}>
          <input
            className="input"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            value={password}
            aria-invalid={Boolean(fields.password)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {mode === "signup" && (
          <Field
            label={t("login.inviteKey")}
            error={fields.inviteKey}
            hint={t("login.inviteKeyHint")}
          >
            <input
              className="input input-key"
              placeholder="abcd-efgh-ijkl"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={inviteKey}
              aria-invalid={Boolean(fields.inviteKey)}
              onChange={(event) => setInviteKey(event.target.value)}
            />
          </Field>
        )}

        {message && <p className="field-error">{message}</p>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy
            ? t("login.fetching")
            : isSetup
              ? t("login.createAdmin")
              : isLogin
                ? t("login.title")
                : t("login.signUpTitle")}
        </button>

        {!isSetup && (
          <button
            className="btn btn-ghost btn-block"
            type="button"
            onClick={() => {
              setMode(isLogin ? "signup" : "login");
              setFields({});
              setMessage(null);
            }}
          >
            {isLogin ? t("login.haveKey") : t("login.haveAccount")}
          </button>
        )}
      </form>
    </main>
  );
}
