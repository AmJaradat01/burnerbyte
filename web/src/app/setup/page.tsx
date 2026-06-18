"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, setAccessToken, setSessionHint } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import {
  ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Globe, HardDrive,
  Loader2, Mail, Paintbrush, Plus, RefreshCw, Shield, SkipForward,
  Trash2, UserPlus, Users, X, XCircle,
} from "lucide-react";

const STEPS = [
  { key: "admin", label: "Admin Account", icon: Shield, required: true },
  { key: "org", label: "Organization", icon: Building2, required: true },
  { key: "smtp", label: "Outbound Email", icon: Mail, required: true },
  { key: "storage", label: "Object Storage", icon: HardDrive, required: false },
  { key: "domain", label: "Domain", icon: Globe, required: true },
  { key: "team", label: "Team", icon: Users, required: false },
  { key: "branding", label: "Branding", icon: Paintbrush, required: false },
  { key: "invites", label: "Invite Users", icon: UserPlus, required: false },
  { key: "review", label: "Review & Finish", icon: CheckCircle2, required: true },
] as const;

interface SetupData {
  admin: { email: string; password: string; display_name: string };
  org: { name: string; slug: string; logo_url: string };
  smtp: { host: string; port: number; username: string; password: string; from_address: string; from_name: string };
  storage: { provider: string; endpoint: string; access_key: string; secret_key: string; bucket: string; region: string; use_ssl: boolean } | null;
  domain: { domain_name: string };
  team: { name: string } | null;
  branding: { footer_text: string; logo_url: string } | null;
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

function passwordStrength(pw: string): { pct: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const pct = (score / 5) * 100;
  if (pct <= 40) return { pct, label: "Weak", color: "bg-destructive/50" };
  if (pct <= 60) return { pct, label: "Fair", color: "bg-warning/50" };
  return { pct, label: "Strong", color: "bg-success/50" };
}

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<SetupData>(initialData);
  const [submitting, setSubmitting] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ postgres: boolean; redis: boolean } | null>(null);
  const [smtpTest, setSmtpTest] = useState<{ testing: boolean; result: { success: boolean; message: string; response_time: string } | null }>({ testing: false, result: null });
  const [storageTest, setStorageTest] = useState<{ testing: boolean; result: { success: boolean; message: string; response_time: string } | null }>({ testing: false, result: null });

  useEffect(() => {
    api.get<{ completed: boolean }>("/setup/status")
      .then((res) => {
        if (res.completed) router.replace("/login");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  // Check infrastructure health on mount
  useEffect(() => {
    if (!checking) {
      fetch("/readyz").then((r) => r.json()).then((data) => {
        setHealthStatus({ postgres: data.postgres === "ok", redis: data.redis === "ok" });
      }).catch(() => setHealthStatus(null));
    }
  }, [checking]);

  if (checking) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <Logo size="lg" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const currentStep = STEPS[step];
  const StepIcon = currentStep.icon;
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

  const testSMTP = async () => {
    setSmtpTest({ testing: true, result: null });
    try {
      const res = await api.post<{ success: boolean; message: string; response_time: string }>("/setup/test-smtp", {
        host: data.smtp.host, port: data.smtp.port, username: data.smtp.username, password: data.smtp.password, tls: data.smtp.port === 465,
      });
      setSmtpTest({ testing: false, result: res });
    } catch (err) {
      setSmtpTest({ testing: false, result: { success: false, message: err instanceof Error ? err.message : "Test failed", response_time: "" } });
    }
  };

  const testStorage = async () => {
    const s = data.storage;
    if (!s?.endpoint) return;
    setStorageTest({ testing: true, result: null });
    try {
      const res = await api.post<{ success: boolean; message: string; response_time: string }>("/setup/test-storage", {
        endpoint: s.endpoint, access_key: s.access_key, secret_key: s.secret_key, bucket: s.bucket || "burnerbyte", use_ssl: s.use_ssl,
      });
      setStorageTest({ testing: false, result: res });
    } catch (err) {
      setStorageTest({ testing: false, result: { success: false, message: err instanceof Error ? err.message : "Test failed", response_time: "" } });
    }
  };

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
      if (data.branding && (data.branding.footer_text || data.branding.logo_url)) {
        payload.branding = {
          footer_text: data.branding.footer_text || undefined,
          logo_url: data.branding.logo_url || undefined,
        };
      }
      if (data.invites.length > 0) payload.invites = data.invites.filter((i) => i.email);

      payload.use_cookie = true; // refresh token arrives as an httpOnly cookie
      const res = await api.post<{ tokens: { access_token: string } }>("/setup/complete", payload);
      setAccessToken(res.tokens.access_token);
      setSessionHint(true);
      toast.success("Setup complete! Redirecting…");
      setTimeout(() => { window.location.href = "/inboxes"; }, 1000);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <Logo size="lg" />
          <p className="text-muted-foreground text-sm">One-time platform configuration</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-between px-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.key} className="flex items-center">
                <button
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  title={s.label}
                  className={`flex items-center justify-center h-7 w-7 rounded-full text-xs ${
                    done ? "bg-primary text-primary-foreground cursor-pointer" : active ? "bg-primary/20 text-primary ring-2 ring-primary/30" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3 w-3" />}
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`w-3 sm:w-5 lg:w-7 h-0.5 mx-0.5 rounded-full ${i < step ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${currentStep.required ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                <StepIcon className="h-[18px] w-[18px]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg tracking-tight">{currentStep.label}</CardTitle>
                  <Badge variant={currentStep.required ? "default" : "secondary"} className="text-[10px]">
                    {currentStep.required ? "Required" : "Optional"}
                  </Badge>
                </div>
                <CardDescription className="mt-0.5">
                  {currentStep.key === "admin" && "Create the platform owner account with full system admin privileges."}
                  {currentStep.key === "org" && "Set up your organization. BurnerByte runs as a single-org platform."}
                  {currentStep.key === "smtp" && "Configure outbound email for invitations, password resets, and verification."}
                  {currentStep.key === "storage" && "Configure S3-compatible object storage for email attachments."}
                  {currentStep.key === "domain" && "Add the domain that will receive temporary emails."}
                  {currentStep.key === "team" && "Create an initial team and assign the domain to it."}
                  {currentStep.key === "branding" && "Customize the look and feel of your instance."}
                  {currentStep.key === "invites" && "Invite team members by email."}
                  {currentStep.key === "review" && "Review your configuration and finish setup."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Admin */}
            {currentStep.key === "admin" && (
              <>
                {/* Infrastructure health check */}
                {healthStatus && (
                  <div className={`rounded-lg border p-3 flex items-center gap-3 ${healthStatus.postgres && healthStatus.redis ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"}`}>
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${healthStatus.postgres && healthStatus.redis ? "bg-success/10" : "bg-destructive/10"}`}>
                      {healthStatus.postgres && healthStatus.redis ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${healthStatus.postgres && healthStatus.redis ? "text-success" : "text-destructive"}`}>
                        {healthStatus.postgres && healthStatus.redis ? "Infrastructure ready" : "Infrastructure issue detected"}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className={`text-xs flex items-center gap-1 ${healthStatus.postgres ? "text-success" : "text-destructive"}`}>
                          {healthStatus.postgres ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} PostgreSQL
                        </span>
                        <span className={`text-xs flex items-center gap-1 ${healthStatus.redis ? "text-success" : "text-destructive"}`}>
                          {healthStatus.redis ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} Redis
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="admin-name">Display name</Label>
                  <Input id="admin-name" value={data.admin.display_name} onChange={(e) => setData({ ...data, admin: { ...data.admin, display_name: e.target.value } })} placeholder="Your full name" autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input id="admin-email" type="email" value={data.admin.email} onChange={(e) => setData({ ...data, admin: { ...data.admin, email: e.target.value } })} placeholder="admin@example.com" />
                  {data.admin.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.admin.email) && (
                    <p className="text-xs text-destructive">Please enter a valid email address</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-pass">Password</Label>
                  <Input id="admin-pass" type="password" value={data.admin.password} onChange={(e) => setData({ ...data, admin: { ...data.admin, password: e.target.value } })} placeholder="••••••••" />
                  {data.admin.password && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${passwordStrength(data.admin.password).color}`} style={{ width: `${passwordStrength(data.admin.password).pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-10">{passwordStrength(data.admin.password).label}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {[
                          { met: data.admin.password.length >= 8, label: "8+ chars" },
                          { met: /[A-Z]/.test(data.admin.password), label: "Uppercase" },
                          { met: /[a-z]/.test(data.admin.password), label: "Lowercase" },
                          { met: /\d/.test(data.admin.password), label: "Number" },
                          { met: /[^A-Za-z0-9]/.test(data.admin.password), label: "Special" },
                        ].map((r) => (
                          <span key={r.label} className={`text-[10px] flex items-center gap-0.5 ${r.met ? "text-success" : "text-muted-foreground"}`}>
                            {r.met ? <Check className="h-2.5 w-2.5" /> : <span className="h-2.5 w-2.5 rounded-full border border-current inline-block" />} {r.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Org */}
            {currentStep.key === "org" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="org-name">Organization name</Label>
                  <Input id="org-name" value={data.org.name} onChange={(e) => setData({ ...data, org: { ...data.org, name: e.target.value } })} placeholder="My Company" autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="org-slug">Slug <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input id="org-slug" value={data.org.slug} onChange={(e) => setData({ ...data, org: { ...data.org, slug: e.target.value } })} placeholder="my-company" className="font-mono text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="org-logo">Logo URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input id="org-logo" value={data.org.logo_url} onChange={(e) => setData({ ...data, org: { ...data.org, logo_url: e.target.value } })} placeholder="https://..." />
                  </div>
                </div>
              </>
            )}

            {/* SMTP */}
            {currentStep.key === "smtp" && (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="smtp-host">SMTP Host</Label>
                    <Input id="smtp-host" value={data.smtp.host} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, host: e.target.value } })} placeholder="smtp.example.com" autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input id="smtp-port" type="number" value={data.smtp.port} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, port: Number(e.target.value) } })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-user">Username</Label>
                    <Input id="smtp-user" value={data.smtp.username} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, username: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-pass">Password</Label>
                    <Input id="smtp-pass" type="password" value={data.smtp.password} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, password: e.target.value } })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-from">From address <span className="text-destructive">*</span></Label>
                    <Input id="smtp-from" type="email" value={data.smtp.from_address} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, from_address: e.target.value } })} placeholder="noreply@example.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-name">From name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input id="smtp-name" value={data.smtp.from_name} onChange={(e) => setData({ ...data, smtp: { ...data.smtp, from_name: e.target.value } })} placeholder="BurnerByte" />
                  </div>
                </div>
                {/* Test connection button */}
                {data.smtp.host && data.smtp.port > 0 && (
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={testSMTP} disabled={smtpTest.testing}>
                      {smtpTest.testing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</> : <><RefreshCw className="h-3.5 w-3.5" /> Test Connection</>}
                    </Button>
                    {smtpTest.result && (
                      <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${smtpTest.result.success ? "bg-success/5 border-success/20 text-success" : "bg-destructive/5 border-destructive/20 text-destructive"}`}>
                        {smtpTest.result.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                        <div>
                          <p className="font-medium">{smtpTest.result.success ? "Connection successful" : "Connection failed"}</p>
                          <p className="text-xs mt-0.5 opacity-80">{smtpTest.result.message}{smtpTest.result.response_time && ` (${smtpTest.result.response_time})`}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Storage */}
            {currentStep.key === "storage" && (() => {
              const s = data.storage ?? { provider: "minio", endpoint: "", access_key: "", secret_key: "", bucket: "burnerbyte", region: "", use_ssl: false };
              const update = (patch: Partial<typeof s>) => setData({ ...data, storage: { ...s, ...patch } });
              return (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="storage-provider">Provider</Label>
                    <Select value={s.provider} onValueChange={(v) => update({ provider: v })}>
                      <SelectTrigger id="storage-provider"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minio">MinIO</SelectItem>
                        <SelectItem value="s3">AWS S3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="storage-endpoint">Endpoint</Label>
                      <Input id="storage-endpoint" value={s.endpoint} onChange={(e) => update({ endpoint: e.target.value })} placeholder={s.provider === "s3" ? "s3.amazonaws.com" : "localhost:9000"} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="storage-bucket">Bucket</Label>
                      <Input id="storage-bucket" value={s.bucket} onChange={(e) => update({ bucket: e.target.value })} placeholder="burnerbyte" className="font-mono text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="storage-access-key">Access key</Label>
                      <Input id="storage-access-key" value={s.access_key} onChange={(e) => update({ access_key: e.target.value })} className="font-mono text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="storage-secret-key">Secret key</Label>
                      <Input id="storage-secret-key" type="password" value={s.secret_key} onChange={(e) => update({ secret_key: e.target.value })} />
                    </div>
                  </div>
                  {s.provider === "s3" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="storage-region">Region</Label>
                      <Input id="storage-region" value={s.region} onChange={(e) => update({ region: e.target.value })} placeholder="us-east-1" />
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label htmlFor="storage-use-ssl" className="cursor-pointer">Use SSL/TLS</Label>
                    <Switch id="storage-use-ssl" checked={s.use_ssl} onCheckedChange={(v) => update({ use_ssl: v })} />
                  </div>
                  <p className="text-xs text-muted-foreground">Skip to use environment variables or config file instead.</p>
                  {/* Test connection button */}
                  {s.endpoint && (
                    <div className="space-y-2">
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={testStorage} disabled={storageTest.testing}>
                        {storageTest.testing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</> : <><RefreshCw className="h-3.5 w-3.5" /> Test Connection</>}
                      </Button>
                      {storageTest.result && (
                        <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${storageTest.result.success ? "bg-success/5 border-success/20 text-success" : "bg-destructive/5 border-destructive/20 text-destructive"}`}>
                          {storageTest.result.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                          <div>
                            <p className="font-medium">{storageTest.result.success ? "Connection successful" : "Connection failed"}</p>
                            <p className="text-xs mt-0.5 opacity-80">{storageTest.result.message}{storageTest.result.response_time && ` (${storageTest.result.response_time})`}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Domain */}
            {currentStep.key === "domain" && (
              <div className="space-y-1.5">
                <Label htmlFor="domain-name">Domain name</Label>
                <Input id="domain-name" value={data.domain.domain_name} onChange={(e) => setData({ ...data, domain: { ...data.domain, domain_name: e.target.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") } })} placeholder="mail.example.com" autoFocus className="font-mono" />
                {data.domain.domain_name && !data.domain.domain_name.includes(".") && (
                  <p className="text-xs text-destructive">Domain must contain at least one dot (e.g., mail.example.com)</p>
                )}
                {data.domain.domain_name && data.domain.domain_name.includes(".") && (
                  <p className="text-xs text-success flex items-center gap-1"><Check className="h-3 w-3" /> Valid domain format</p>
                )}
                <p className="text-xs text-muted-foreground">This domain will receive inbound emails. You&apos;ll configure MX and TXT records after setup.</p>
              </div>
            )}

            {/* Team */}
            {currentStep.key === "team" && (
              <div className="space-y-1.5">
                <Label htmlFor="team-name">Team name</Label>
                <Input id="team-name" value={data.team?.name ?? ""} onChange={(e) => setData({ ...data, team: e.target.value ? { name: e.target.value } : null })} placeholder="Engineering" autoFocus />
                <p className="text-xs text-muted-foreground">The domain will be automatically assigned to this team. Leave empty to skip.</p>
              </div>
            )}

            {/* Branding */}
            {currentStep.key === "branding" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-logo">Logo URL</Label>
                  <Input id="brand-logo" value={data.branding?.logo_url ?? ""} onChange={(e) => setData({ ...data, branding: { ...data.branding ?? { footer_text: "", logo_url: "" }, logo_url: e.target.value } })} placeholder="https://..." />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-footer">Footer text</Label>
                  <Input id="brand-footer" value={data.branding?.footer_text ?? ""} onChange={(e) => setData({ ...data, branding: { ...data.branding ?? { footer_text: "", logo_url: "" }, footer_text: e.target.value } })} placeholder="Powered by BurnerByte" />
                </div>
                <p className="text-xs text-muted-foreground">All fields optional. Configurable later in Settings.</p>
              </>
            )}

            {/* Invites */}
            {currentStep.key === "invites" && (
              <>
                <div className="space-y-2">
                  {data.invites.map((inv, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input value={inv.email} onChange={(e) => { const invites = [...data.invites]; invites[i] = { ...invites[i], email: e.target.value }; setData({ ...data, invites }); }} placeholder="user@example.com" type="email" className="flex-1" />
                      <Select value={inv.role} onValueChange={(v) => { const invites = [...data.invites]; invites[i] = { ...invites[i], role: v }; setData({ ...data, invites }); }}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0" aria-label="Remove invite" onClick={() => setData({ ...data, invites: data.invites.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setData({ ...data, invites: [...data.invites, { email: "", role: "member" }] })}>
                  <Plus className="h-3.5 w-3.5" /> Add invite
                </Button>
                <p className="text-xs text-muted-foreground">Invitations are sent after setup completes. You can invite more users later.</p>
              </>
            )}

            {/* Review */}
            {currentStep.key === "review" && (
              <div className="divide-y rounded-lg border overflow-hidden">
                {[
                  { icon: Shield, label: "Admin", value: `${data.admin.display_name} (${data.admin.email})` },
                  { icon: Building2, label: "Organization", value: data.org.name },
                  { icon: Mail, label: "SMTP", value: `${data.smtp.host}:${data.smtp.port} → ${data.smtp.from_address}` },
                  { icon: Globe, label: "Domain", value: data.domain.domain_name },
                  ...(data.storage?.endpoint ? [{ icon: HardDrive, label: "Storage", value: `${data.storage.provider.toUpperCase()} — ${data.storage.endpoint}` }] : []),
                  ...(data.team?.name ? [{ icon: Users, label: "Team", value: data.team.name }] : []),
                  ...(data.branding?.logo_url ? [{ icon: Paintbrush, label: "Branding", value: data.branding.logo_url }] : []),
                  ...(data.invites.filter(i => i.email).length > 0 ? [{ icon: UserPlus, label: "Invites", value: data.invites.filter(i => i.email).map(i => i.email).join(", ") }] : []),
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-muted-foreground font-mono">{item.label}</span>
                        <p className="text-sm font-medium truncate">{item.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-between border-t pt-4">
            <Button variant="outline" size="sm" onClick={prev} disabled={step === 0} className="gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <div className="flex gap-2">
              {!currentStep.required && !isLast && (
                <Button variant="ghost" size="sm" onClick={next} className="gap-1.5 text-muted-foreground">
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </Button>
              )}
              {isLast ? (
                <Button onClick={submit} disabled={submitting} className="gap-1.5">
                  {submitting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Setting up…</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Complete Setup</>}
                </Button>
              ) : (
                <Button onClick={next} disabled={!canNext()} className="gap-1.5">
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>

        {/* Step counter */}
        <p className="text-center text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>
    </div>
  );
}
