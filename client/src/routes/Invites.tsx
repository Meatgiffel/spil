import { useCallback, useEffect, useState } from "react";
import { ApiError, api, post } from "../api.js";
import { Empty, Field, Loading, ScreenHead } from "../components.js";
import { formatDate } from "../format.js";

type InviteKey = {
  id: string;
  label: string | null;
  maxUses: number;
  uses: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

type Created = { id: string; key: string; label: string | null; maxUses: number };

function statusOf(invite: InviteKey): { text: string; tone: "accent" | "outline" } {
  if (invite.revokedAt) return { text: "Tilbagekaldt", tone: "outline" };
  if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) {
    return { text: "Udløbet", tone: "outline" };
  }
  if (invite.uses >= invite.maxUses) return { text: "Opbrugt", tone: "outline" };
  return { text: "Kan bruges", tone: "accent" };
}

export function InvitesScreen() {
  const [invites, setInvites] = useState<InviteKey[] | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<{ inviteKeys: InviteKey[] }>("/api/invites");
      setInvites(body.inviteKeys);
      setError(null);
    } catch (caught) {
      setInvites([]);
      setError(
        caught instanceof ApiError && caught.status === 0
          ? "Nøgler kræver forbindelse — de gemmes ikke lokalt."
          : "Kunne ikke hente nøglerne.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const parsed = Number.parseInt(maxUses, 10);
      const body = await post<{ inviteKey: Created }>("/api/invites", {
        label: label.trim() || null,
        maxUses: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
        expiresAt: null,
      });
      setCreated(body.inviteKey);
      setLabel("");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Der gik noget galt.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Tilbagekald nøglen?")) return;
    try {
      await post(`/api/invites/${id}/revoke`, {});
      await load();
    } catch {
      setError("Kunne ikke tilbagekalde nøglen.");
    }
  }

  return (
    <main className="screen">
      <ScreenHead title="Invitationsnøgler" back />

      <div className="screen-body">
        {created && (
          <section className="card" style={{ borderColor: "var(--accent)" }}>
            <span className="kicker" style={{ color: "var(--accent)" }}>
              Nøglen vises kun denne ene gang
            </span>
            <output
              style={{
                font: "800 26px/1.2 var(--mono)",
                letterSpacing: "0.08em",
                wordBreak: "break-all",
              }}
            >
              {created.key}
            </output>
            <p className="lede">
              Skriv den ned eller send den nu. Databasen gemmer kun et hash, så den
              kan ikke hentes frem igen.
            </p>
            <div className="row">
              <button
                className="btn btn-secondary grow"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(created.key)}
              >
                Kopiér
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setCreated(null)}
              >
                Færdig
              </button>
            </div>
          </section>
        )}

        <section className="stack">
          <h2>Ny nøgle</h2>
          <Field label="Til hvem (valgfrit)">
            <input
              className="input"
              value={label}
              maxLength={80}
              placeholder="Fx “Mette”"
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field label="Antal gange den kan bruges">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
            />
          </Field>
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? "Opretter…" : "Opret nøgle"}
          </button>
        </section>

        {error && <p className="field-error">{error}</p>}

        <hr className="rule" />

        <section className="stack">
          <h2>Udstedte nøgler</h2>
          {invites === null && <Loading rows={2} />}
          {invites?.length === 0 && !error && (
            <Empty title="Ingen nøgler endnu" body="Opret én for at invitere nogen." />
          )}
          <div className="stack-tight">
            {(invites ?? []).map((invite) => {
              const status = statusOf(invite);
              const active = status.text === "Kan bruges";
              return (
                <div key={invite.id} className="card card-flat">
                  <div className="spread">
                    <span className="name">{invite.label ?? "Uden navn"}</span>
                    <span
                      className={status.tone === "accent" ? "tag tag-accent" : "tag tag-outline"}
                    >
                      {status.text}
                    </span>
                  </div>
                  <span className="lede">
                    Brugt {invite.uses} af {invite.maxUses} · oprettet{" "}
                    {formatDate(invite.createdAt)}
                  </span>
                  {active && (
                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() => void revoke(invite.id)}
                    >
                      Tilbagekald
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
