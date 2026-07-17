"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import {
  ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Copy, Globe,
  Inbox, Mail, RefreshCw, SkipForward, Users,
} from "lucide-react";
import type { Organization, Team } from "@/types";

const STEPS = [
  { label: "Organization", icon: Building2 },
  { label: "Domain", icon: Globe },
  { label: "Team", icon: Users },
  { label: "Inbox", icon: Inbox },
  { label: "Done", icon: CheckCircle2 },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { currentOrg, fetchOrgs, setCurrentOrg, fetchTeams, setCurrentTeam } = useOrgStore();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (currentOrg) router.replace("/dashboard");
  }, [currentOrg, router]);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [org, setOrg] = useState<Organization | null>(null);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [domainName, setDomainName] = useState("");
  const [verificationRecord, setVerificationRecord] = useState("");
  const [team, setTeam] = useState<Team | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [inboxAddress, setInboxAddress] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [teamName, setTeamName] = useState("");
  const [copied, setCopied] = useState(false);

  const createOrg = async () => {
    setBusy(true);
    try {
      const res = await api.post<Organization>("/orgs", { name: orgName });
      setOrg(res);
      setStep(1);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  const addDomain = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ id: string; domain_name: string; verification_record?: string }>(`/orgs/${org!.id}/domains`, { domain_name: domainInput });
      setDomainId(res.id);
      setDomainName(res.domain_name);
      setVerificationRecord(res.verification_record || "");
      setStep(2);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  const createTeam = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ team: Team }>(`/orgs/${org!.id}/teams`, { name: teamName });
      setTeam(res.team);
      if (domainId) {
        const assignment = await api.post<{ id: string }>(`/orgs/${org!.id}/teams/${res.team.id}/domains`, { domain_id: domainId, access_level: "full" });
        setAssignmentId(assignment.id);
      }
      setStep(3);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  const createInbox = async () => {
    if (!assignmentId) { setStep(4); return; }
    setBusy(true);
    try {
      const res = await api.post<{ full_address: string }>("/inboxes", { domain_assignment_id: assignmentId, ttl: "1h" });
      setInboxAddress(res.full_address);
      setStep(4);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await fetchOrgs();
      if (org) setCurrentOrg(org);
      if (org) {
        await fetchTeams(org.id);
        if (team) setCurrentTeam(team);
      }
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  };

  const copyRecord = () => {
    copyToClipboard(verificationRecord);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <div className="w-full max-w-lg space-y-6">
        {/* Logo */}
        <div className="text-center">
          <Logo size="lg" />
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center gap-1">
          {STEPS.map((s, i) => {
            const StepIcon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.label} className="flex items-center">
                <div
                  className={`flex items-center justify-center h-8 w-8 rounded-full text-xs font-semibold transition-all duration-200 ${
                    done
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : active
                        ? "bg-primary/15 text-primary ring-2 ring-primary/40"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : <StepIcon className="h-3.5 w-3.5" />}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-0.5 mx-1 rounded-full transition-colors duration-300 ${i < step ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <Card>
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl tracking-tight">{STEPS[step].label}</CardTitle>
            <CardDescription>
              {step === 0 && "Create your organization to get started"}
              {step === 1 && "Add a domain to receive temporary emails"}
              {step === 2 && "Create a team to organize your inboxes"}
              {step === 3 && "Create your first temporary inbox"}
              {step === 4 && "You're all set!"}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 animate-in fade-in duration-200">
            {/* Step 0: Org */}
            {step === 0 && (
              user?.is_system_admin ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="onb-org-name">Organization name</Label>
                    <Input id="onb-org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="My Company" autoFocus onKeyDown={(e) => e.key === "Enter" && orgName && createOrg()} />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={createOrg} disabled={!orgName || busy} className="gap-1.5">
                      {busy ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Creating…</> : <>Create org <ArrowRight className="h-3.5 w-3.5" /></>}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 space-y-4">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Mail className="h-5 w-5" />
                    <span className="text-sm font-medium">Waiting for an invitation</span>
                  </div>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Ask your organization admin to send you an invite. Once accepted, you&apos;ll be redirected automatically.
                  </p>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { fetchOrgs(); toast.info("Checking…"); }}>
                    <RefreshCw className="h-3.5 w-3.5" /> Check again
                  </Button>
                </div>
              )
            )}

            {/* Step 1: Domain */}
            {step === 1 && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="onb-domain">Domain name</Label>
                  <Input id="onb-domain" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} placeholder="mail.example.com" autoFocus onKeyDown={(e) => e.key === "Enter" && domainInput && addDomain()} />
                  <p className="text-xs text-muted-foreground">This domain will receive inbound emails. You&apos;ll configure DNS records after setup.</p>
                </div>
                <div className="flex justify-between">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setStep(0)} disabled={busy} className="gap-1"><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
                    <Button variant="ghost" size="sm" onClick={() => setStep(2)} disabled={busy} className="gap-1 text-muted-foreground"><SkipForward className="h-3.5 w-3.5" /> Skip</Button>
                  </div>
                  <Button onClick={addDomain} disabled={!domainInput || busy} className="gap-1.5">
                    {busy ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Adding…</> : <>Add domain <ArrowRight className="h-3.5 w-3.5" /></>}
                  </Button>
                </div>
              </>
            )}

            {/* Step 2: Team */}
            {step === 2 && (
              <>
                {verificationRecord && (
                  <div className="rounded-lg border bg-warning/5 p-3 space-y-2">
                    <p className="text-sm font-medium text-warning">DNS Records for {domainName}</p>
                    <p className="text-xs text-warning">Add this TXT record to verify ownership:</p>
                    <button onClick={copyRecord} className="w-full rounded-md bg-card border px-3 py-2 text-left font-mono text-xs break-all hover:bg-muted/50 group flex items-center gap-2">
                      <span className="flex-1">{verificationRecord}</span>
                      {copied ? <Check className="h-3.5 w-3.5 text-success shrink-0" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    </button>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="onb-team-name">Team name</Label>
                  <Input id="onb-team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Engineering" autoFocus onKeyDown={(e) => e.key === "Enter" && teamName && createTeam()} />
                </div>
                <div className="flex justify-between">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={busy} className="gap-1"><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
                    <Button variant="ghost" size="sm" onClick={() => setStep(3)} disabled={busy} className="gap-1 text-muted-foreground"><SkipForward className="h-3.5 w-3.5" /> Skip</Button>
                  </div>
                  <Button onClick={createTeam} disabled={!teamName || busy} className="gap-1.5">
                    {busy ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Creating…</> : <>Create team <ArrowRight className="h-3.5 w-3.5" /></>}
                  </Button>
                </div>
              </>
            )}

            {/* Step 3: Inbox */}
            {step === 3 && (
              <>
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    {assignmentId
                      ? "Create your first temporary inbox to start receiving emails."
                      : "No domain was configured. You can set one up later in Settings."}
                  </p>
                </div>
                <div className="flex justify-between">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setStep(2)} disabled={busy} className="gap-1"><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
                    <Button variant="ghost" size="sm" onClick={() => setStep(4)} disabled={busy} className="gap-1 text-muted-foreground"><SkipForward className="h-3.5 w-3.5" /> Skip</Button>
                  </div>
                  {assignmentId ? (
                    <Button onClick={createInbox} disabled={busy} className="gap-1.5">
                      {busy ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Creating…</> : <>Create inbox <ArrowRight className="h-3.5 w-3.5" /></>}
                    </Button>
                  ) : (
                    <Button onClick={() => setStep(4)} className="gap-1.5">Continue <ArrowRight className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </>
            )}

            {/* Step 4: Done */}
            {step === 4 && (
              <div className="text-center py-6 space-y-4">
                <div className="flex items-center justify-center gap-2 text-success">
                  <CheckCircle2 className="h-5 w-5" />
                  <p className="text-lg font-semibold tracking-tight">You&apos;re all set!</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Your workspace is ready to go.</p>
                </div>
                {inboxAddress && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Your first inbox</p>
                    <p className="font-mono text-sm font-medium">{inboxAddress}</p>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {org && (
                    <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {org.name}</span>
                      {domainName && <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {domainName}</span>}
                      {team && <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {team.name}</span>}
                    </div>
                  )}
                </div>
                <Button onClick={finish} className="w-full gap-1.5" disabled={busy}>
                  {busy ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading…</> : "Go to Dashboard"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
