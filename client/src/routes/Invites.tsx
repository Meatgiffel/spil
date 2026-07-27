import { useCallback, useEffect, useState } from "react";
import { ApiError, api, post } from "../api.js";
import { Empty, Field, Loading, ScreenHead } from "../components.js";
import { formatDate } from "../format.js";
import { translateError, useT, type Translate } from "../i18n/index.js";

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

function statusOf(
  invite: InviteKey,
  t: Translate,
): { text: string; usable: boolean } {
  if (invite.revokedAt) return { text: t("invites.revoked"), usable: false };
  if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) {
    return { text: t("invites.expired"), usable: false };
  }
  if (invite.uses >= invite.maxUses) return { text: t("invites.usedUp"), usable: false };
  return { text: t("invites.usable"), usable: true };
}

export function InvitesScreen() {
  const t = useT();
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
          ? t("invites.needsConnection")
          : t("invites.loadFailed"),
      );
    }
  }, [t]);

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
      setError(
        caught instanceof ApiError
          ? translateError(t, caught.code, caught.message)
          : t("errors.unknown"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm(t("invites.revokeConfirm"))) return;
    try {
      await post(`/api/invites/${id}/revoke`, {});
      await load();
    } catch {
      setError(t("invites.revokeFailed"));
    }
  }

  return (
    <main className="screen">
      <ScreenHead title={t("invites.title")} back />

      <div className="screen-body">
        {created && (
          <section className="card" style={{ borderColor: "var(--accent)" }}>
            <span className="kicker" style={{ color: "var(--accent)" }}>
              {t("invites.shownOnce")}
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
            <p className="lede">{t("invites.shownOnceBody")}</p>
            <div className="row">
              <button
                className="btn btn-secondary grow"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(created.key)}
              >
                {t("action.copy")}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setCreated(null)}
              >
                {t("action.done")}
              </button>
            </div>
          </section>
        )}

        <section className="stack">
          <h2>{t("invites.newKey")}</h2>
          <Field label={t("invites.forWhom")}>
            <input
              className="input"
              value={label}
              maxLength={80}
              placeholder={t("invites.forWhomPlaceholder")}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field label={t("invites.maxUses")}>
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
            {busy ? t("invites.creating") : t("invites.createKey")}
          </button>
        </section>

        {error && <p className="field-error">{error}</p>}

        <hr className="rule" />

        <section className="stack">
          <h2>{t("invites.issued")}</h2>
          {invites === null && <Loading rows={2} />}
          {invites?.length === 0 && !error && (
            <Empty title={t("invites.emptyTitle")} body={t("invites.emptyBody")} />
          )}
          <div className="stack-tight">
            {(invites ?? []).map((invite) => {
              const status = statusOf(invite, t);
              return (
                <div key={invite.id} className="card card-flat">
                  <div className="spread">
                    <span className="name">{invite.label ?? t("invites.unnamed")}</span>
                    <span
                      className={status.usable ? "tag tag-accent" : "tag tag-outline"}
                    >
                      {status.text}
                    </span>
                  </div>
                  <span className="lede">
                    {t("invites.usedOf", {
                      uses: invite.uses,
                      maxUses: invite.maxUses,
                      date: formatDate(invite.createdAt),
                    })}
                  </span>
                  {status.usable && (
                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() => void revoke(invite.id)}
                    >
                      {t("invites.revoke")}
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
