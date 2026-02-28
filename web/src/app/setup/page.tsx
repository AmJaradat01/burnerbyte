"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const STEPS = [
  { key: "admin", label: "Admin Account", required: true },
  { key: "org", label: "Organization", required: true },
  { key: "smtp", label: "SMTP / Email", required: true },
  { key: "storage", label: "Object Storage", required: false },
  { key: "domain", label: "Domain", required: true },
  { key: "team", label: "Team", required: false },
  { key: "branding", label: "Branding", required: false },
  { key: "invites", label: "Invite Users", required: false },
  { key: "review", label: "Review & Finish", required: true },
] as const;

interface SetupData {
  admin: { email: string; password: string; display_name: string };
  org: { name: string; slug: string; logo_url: string };
  smtp: { host: string; port: number; username: string; password: string; from_address: string; from_name: string };
  storage: { provider: string; endpoint: string; access_key: string; secret_key: string; bucket: string; region: string; use_ssl: boolean } | null;
  domain: { domain_name: string };
  team: { name: string } | null;
  branding: { primary_color: string; footer_text: string; logo_url: string } | null;
  invites: { email: string; role: string }[];
}

const initialData: SetupData = {
  admin: { email: "", password: "", display_name: "" },
  org: { name: "", slug: "", logo_url: "" },
  smtp: { host: "", port: 587, username: "", password: "", from_address: "", from_name: "" },
  storage: null,
  domain: { domain_name: "" },
  team: null,
  branding: null,
  invites: [],
};

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<SetupData>(initialData);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ completed: boolean }>("/setup/status")
      .then((res) => {
        if (res.completed) router.replace("/login");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
          <span className="sr-only">Loading</span>
        </div>
      </div>
    );
  }

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const canNext = (): boolean => {
    switch (currentStep.key) {
      case "admin": return !!(data.admin.email && data.admin.password && data.admin.display_name);
      case "org": return !!data.org.name;
      case "smtp": return !!(data.smtp.host && data.smtp.port && data.smtp.from_address);
      case "domain": return !!data.domain.domain_name;
      default: return true;
    }
  };

  const next = () => { if (step < STEPS.length - 1) setStep(step + 1); };
  const prev = () => { if (step > 0) setStep(step - 1); };
  const skip = () => next();

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        admin: data.admin,
        org: { name: data.org.name, slug: data.org.slug || undefined, logo_url: data.org.logo_url || undefined },
        smtp: data.smtp,
        domain: data.domain,
      };
      if (data.team?.name) payload.team = data.team;
      if (data.storage && data.storage.endpoint) payload.storage = data.storage;
      if (data.branding && (data.branding.primary_color || data.branding.footer_text || data.branding.logo_url)) {
        payload.branding = {
          primary_color: data.branding.primary_color || undefined,
          footer_text: data.branding.footer_text || undefined,
          logo_url: data.branding.logo_url || undefined,
        };
      }
      if (data.invites.length > 0) payload.invites = data.invites.filter((i) => i.email);

      const res = await api.post<{ tokens: { access_token: string; refresh_token: string } }>("/setup/complete", payload);
      localStorage.setItem("access_token", res.tokens.access_token);
      localStorage.setItem("refresh_token", res.tokens.refresh_token);
      toast.success("Setup complete! Redirecting…");
      setTimeout(() => { window.location.href = "/inboxes"; }, 1000);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">🔥 BurnerByte Setup</h1>
          <p className="text-muted-foreground mt-1">One-time platform configuration</p>
        </div>

        {/* Progress */}
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => i < step && setStep(i)}
              className={`h-2 flex-1 rounded-full transition-colors ${
                i < step ? "bg-primary" : i === step ? "bg-primary/60" : "bg-muted"
              }`}
              aria-label={`Step ${i + 1}: ${s.label}`}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Step {step + 1}: {currentStep.label}</CardTitle>
              <Badge variant={currentStep.required ? "default" : "secondary"}>
                {currentStep.required ? "Required" : "Optional"}
              </Badge>
            </div>
            <CardDescription>
              {currentStep.key === "admin" && "Create the platform owner account with full system admin privileges."}
              {currentStep.key === "org" && "Set up your organization. BurnerByte runs as a single-org platform."}
              {currentStep.key === "smtp" && "Configure outbound email for invitations, password resets, and verification."}
              {currentStep.key === "storage" && "Configure S3-compatible object storage for email attachments (MinIO, AWS S3, etc)."}
              {currentStep.key === "domain" && "Add the domain that will receive temporary emails."}
              {currentStep.key === "team" && "Optionally create an initial team and assign the domain to it."}
              {currentStep.key === "branding" && "Customize the look and feel of your BurnerByte instance."}
              {currentStep.key === "invites" && "Invite team members by email. They'll receive an invitation link."}
              {currentStep.key === "review" && "Review your configuration and finish setup."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {currentStep.key === "admin" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="admin-name">Display name</Label>
                  <Input id="admin-name" value={data.admin.display_name} onChange={(e) => setData({ ...data, admin: { ...data.admin, display_name: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input id="admin-email" type="email" value={data.admin.email} onChange={(e) => setData({ ...data, admin: { ...data.admin, email: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-pass">Password</Label>
                  <Input id="admin-pass" type="password" value={data.admin.password} onChange={(e) => setData({ ...data, admin: { ...data.admin, password: e.target.value } })} />
                  <p className="text-xs text-muted-foreground">Min 8 chars, uppercase, lowercase, number, special character</p>
                </div>
              </>
            )}

            {currentStep.key === "org" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization name</Label>
                  <Input id="org-name" value={data.org.name} onChange={(e) => setData({ ...data, org: { ...data.org, name: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-slug">Slug (optional, auto-generated)</Label>
                  <Input id="org-slug" value={data.org.slug} onChange={(e) => setData({ ...data, org: { ...data.org, slug: e.target.value } })} placeholder="my-org" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-logo">Logo URL (optional)</Label>
                  <Input id="org-logo" value={data.org.logo_url} onChange={(e) => setData({ ...data, org: { ...data.org, logo_url: e.target.value } })} placeholder="https://..." />
                </div>
              </>
            )}

            {currentStep.key === "smtp" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">SMTP Host</Label>
                    <Input id="smtp-host" value={data.smtp.host} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, host: e.target.value } })} placeholder="smtp.example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input id="smtp-port" type="number" value={data.smtp.port} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, port: Number(e.target.value) } })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-user">Username</Label>
                    <Input id="smtp-user" value={data.smtp.username} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, username: e.target.value } })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-pass">Password</Label>
                    <Input id="smtp-pass" type="password" value={data.smtp.password} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, password: e.target.value } })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-from">From address</Label>
                    <Input id="smtp-from" type="email" value={data.smtp.from_address} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, from_address: e.target.value } })} placeholder="noreply@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-name">From name (optional)</Label>
                    <Input id="smtp-name" value={data.smtp.from_name} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, from_name: e.target.value } })} placeholder="BurnerByte" />
                  </div>
                </div>
              </>
            )}

            {currentStep.key === "storage" && (() => {
              const s = data.storage ?? { provider: "minio", endpoint: "", access_key: "", secret_key: "", bucket: "burnerbyte", region: "", use_ssl: false };
              const update = (patch: Partial<typeof s>) => setData({ ...data, storage: { ...s, ...patch } });
              return (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="storage-provider">Provider</Label>
                    <select
                      id="storage-provider"
                      value={s.provider}
                      onChange={(e) => update({ provider: e.target.value })}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    >
                      <option value="minio">MinIO</option>
                      <option value="s3">AWS S3</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="storage-endpoint">Endpoint</Label>
                      <Input id="storage-endpoint" value={s.endpoint} onChange={(e) => update({ endpoint: e.target.value })} placeholder={s.provider === "s3" ? "s3.amazonaws.com" : "localhost:9000"} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storage-bucket">Bucket</Label>
                      <Input id="storage-bucket" value={s.bucket} onChange={(e) => update({ bucket: e.target.value })} placeholder="burnerbyte" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="storage-key">Access key</Label>
                      <Input id="storage-key" value={s.access_key} onChange={(e) => update({ access_key: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storage-secret">Secret key</Label>
                      <Input id="storage-secret" type="password" value={s.secret_key} onChange={(e) => update({ secret_key: e.target.value })} />
                    </div>
                  </div>
                  {s.provider === "s3" && (
                    <div className="space-y-2">
                      <Label htmlFor="storage-region">Region</Label>
                      <Input id="storage-region" value={s.region} onChange={(e) => update({ region: e.target.value })} placeholder="us-east-1" />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="storage-ssl" checked={s.use_ssl} onChange={(e) => update({ use_ssl: e.target.checked })} className="rounded" />
                    <Label htmlFor="storage-ssl">Use SSL/TLS</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">Skip to use environment variables or config file instead. You can also configure this later.</p>
                </>
              );
            })()}

            {currentStep.key === "domain" && (
              <div className="space-y-2">
                <Label htmlFor="domain-name">Domain name</Label>
                <Input id="domain-name" value={data.domain.domain_name} onChange={(e) => setData({ ...data, domain: { ...data.domain, domain_name: e.target.value } })} placeholder="mail.example.com" />
                <p className="text-xs text-muted-foreground">This domain will receive inbound emails. You'll need to configure MX records after setup.</p>
              </div>
            )}

            {currentStep.key === "team" && (
              <div className="space-y-2">
                <Label htmlFor="team-name">Team name</Label>
                <Input
                  id="team-name"
                  value={data.team?.name ?? ""}
                  onChange={(e) => setData({ ...data, team: e.target.value ? { name: e.target.value } : null })}
                  placeholder="Engineering"
                />
                <p className="text-xs text-muted-foreground">Leave empty to skip. You can create teams later.</p>
              </div>
            )}

            {currentStep.key === "branding" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="brand-color">Primary color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="brand-color"
                      value={data.branding?.primary_color ?? ""}
                      onChange={(e) => setData({ ...data, branding: { ...data.branding ?? { primary_color: "", footer_text: "", logo_url: "" }, primary_color: e.target.value } })}
                      placeholder="#0066ff"
                    />
                    {data.branding?.primary_color && (
                      <div className="h-10 w-10 rounded border" style={{ backgroundColor: data.branding.primary_color }} />
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-footer">Footer text</Label>
                  <Input
                    id="brand-footer"
                    value={data.branding?.footer_text ?? ""}
                    onChange={(e) => setData({ ...data, branding: { ...data.branding ?? { primary_color: "", footer_text: "", logo_url: "" }, footer_text: e.target.value } })}
                    placeholder="Powered by BurnerByte"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-logo">Logo URL</Label>
                  <Input
                    id="brand-logo"
                    value={data.branding?.logo_url ?? ""}
                    onChange={(e) => setData({ ...data, branding: { ...data.branding ?? { primary_color: "", footer_text: "", logo_url: "" }, logo_url: e.target.value } })}
                    placeholder="https://..."
                  />
                </div>
                <p className="text-xs text-muted-foreground">All fields optional. You can configure branding later in Settings.</p>
              </>
            )}

            {currentStep.key === "invites" && (
              <>
                {data.invites.map((inv, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={inv.email}
                      onChange={(e) => {
                        const invites = [...data.invites];
                        invites[i] = { ...invites[i], email: e.target.value };
                        setData({ ...data, invites });
                      }}
                      placeholder="user@example.com"
                      type="email"
                    />
                    <select
                      value={inv.role}
                      onChange={(e) => {
                        const invites = [...data.invites];
                        invites[i] = { ...invites[i], role: e.target.value };
                        setData({ ...data, invites });
                      }}
                      className="rounded-md border px-3 py-2 text-sm"
                      aria-label="Role"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => {
                      setData({ ...data, invites: data.invites.filter((_, j) => j !== i) });
                    }}>✕</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => {
                  setData({ ...data, invites: [...data.invites, { email: "", role: "member" }] });
                }}>+ Add invite</Button>
                <p className="text-xs text-muted-foreground">Invitations will be sent after setup completes. You can invite more users later.</p>
              </>
            )}

            {currentStep.key === "review" && (
              <div className="space-y-3 text-sm">
                <div><span className="font-medium">Admin:</span> {data.admin.display_name} ({data.admin.email})</div>
                <Separator />
                <div><span className="font-medium">Organization:</span> {data.org.name}</div>
                <Separator />
                <div><span className="font-medium">SMTP:</span> {data.smtp.host}:{data.smtp.port} (from: {data.smtp.from_address})</div>
                <Separator />
                <div><span className="font-medium">Domain:</span> {data.domain.domain_name}</div>
                {data.storage?.endpoint && <><Separator /><div><span className="font-medium">Storage:</span> {data.storage.provider.toUpperCase()} — {data.storage.endpoint} ({data.storage.bucket})</div></>}
                {data.team?.name && <><Separator /><div><span className="font-medium">Team:</span> {data.team.name}</div></>}
                {data.branding?.primary_color && <><Separator /><div><span className="font-medium">Brand color:</span> {data.branding.primary_color}</div></>}
                {data.invites.length > 0 && <><Separator /><div><span className="font-medium">Invites:</span> {data.invites.filter(i => i.email).map(i => i.email).join(", ")}</div></>}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={prev} disabled={step === 0}>Back</Button>
            <div className="flex gap-2">
              {!currentStep.required && !isLast && (
                <Button variant="ghost" onClick={skip}>Skip</Button>
              )}
              {isLast ? (
                <Button onClick={submit} disabled={submitting}>
                  {submitting ? "Setting up…" : "Complete Setup"}
                </Button>
              ) : (
                <Button onClick={next} disabled={!canNext()}>Next</Button>
              )}
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
