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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Organization, Team } from "@/types";

const STEPS = ["Organization", "Domain", "Team", "Inbox", "Done"];

export default function OnboardingPage() {
  const router = useRouter();
  const { currentOrg, fetchOrgs, setCurrentOrg, fetchTeams, setCurrentTeam } = useOrgStore();
  const user = useAuthStore((s) => s.user);

  // Skip onboarding if user already belongs to an org
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

  // Step 0: Create org
  const [orgName, setOrgName] = useState("");
  const createOrg = async () => {
    setBusy(true);
    try {
      const res = await api.post<Organization>("/orgs", { name: orgName });
      setOrg(res);
      setStep(1);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  // Step 1: Add domain
  const [domainInput, setDomainInput] = useState("");
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

  // Step 2: Create team
  const [teamName, setTeamName] = useState("");
  const createTeam = async () => {
    setBusy(true);
    try {
      const res = await api.post<Team>(`/orgs/${org!.id}/teams`, { name: teamName });
      setTeam(res);
      // Only auto-assign domain if one was added in step 1
      if (domainId) {
        const assignment = await api.post<{ id: string }>(`/orgs/${org!.id}/teams/${res.id}/domains`, { domain_id: domainId, access_level: "full" });
        setAssignmentId(assignment.id);
      }
      setStep(3);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  // Step 3: Create inbox (only if we have a domain assignment)
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

  // Step 4: Done
  const finish = async () => {
    setBusy(true);
    try {
      localStorage.setItem("bb_onboarding_done", "true");
      await fetchOrgs();
      if (org) setCurrentOrg(org);
      if (org) {
        await fetchTeams(org.id);
        if (team) setCurrentTeam(team);
      }
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to complete onboarding");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    localStorage.setItem("bb_onboarding_done", "true");
    router.push("/dashboard");
  };

  const back = () => { if (step > 0) setStep(step - 1); };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle>Welcome to BurnerByte</CardTitle>
          <CardDescription>Let&apos;s get you set up in a few steps</CardDescription>
          <div className="flex justify-center gap-2 mt-4">
            {STEPS.map((s, i) => (
              <Badge key={s} variant={i <= step ? "default" : "outline"} className="text-xs">{s}</Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            user?.is_system_admin ? (
              <>
                <div className="space-y-2">
                  <Label>Organization name</Label>
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="My Company" autoFocus onKeyDown={(e) => e.key === "Enter" && orgName && createOrg()} />
                </div>
                <div className="flex justify-between">
                  <Button variant="ghost" onClick={skip} disabled={busy}>Skip setup</Button>
                  <Button onClick={createOrg} disabled={!orgName || busy}>{busy ? "Creating…" : "Create org →"}</Button>
                </div>
              </>
            ) : (
              <div className="text-center py-6 space-y-3">
                <div className="text-4xl">📬</div>
                <h3 className="text-lg font-semibold">Waiting for an invitation</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Ask your organization admin to send you an invite. Once accepted, you&apos;ll be redirected automatically.
                </p>
                <Button variant="outline" size="sm" onClick={() => { fetchOrgs(); toast.info("Checking…"); }}>
                  Check again
                </Button>
              </div>
            )
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label>Domain name</Label>
                <Input value={domainInput} onChange={(e) => setDomainInput(e.target.value)} placeholder="example.com" autoFocus onKeyDown={(e) => e.key === "Enter" && domainInput && addDomain()} />
              </div>
              <div className="flex justify-between">
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={back} disabled={busy}>← Back</Button>
                  <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>Skip</Button>
                </div>
                <Button onClick={addDomain} disabled={!domainInput || busy}>{busy ? "Adding…" : "Add domain →"}</Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {verificationRecord && (
                <div className="rounded bg-muted p-3 space-y-2">
                  <p className="text-sm font-medium">DNS Records for {domainName}</p>
                  <p className="text-xs text-muted-foreground">Add this TXT record to verify ownership:</p>
                  <code className="text-xs break-all block">{verificationRecord}</code>
                  <Button variant="outline" size="sm" onClick={() => { copyToClipboard(verificationRecord); toast.success("Copied"); }}>Copy</Button>
                </div>
              )}
              <div className="space-y-2">
                <Label>Team name</Label>
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Engineering" autoFocus onKeyDown={(e) => e.key === "Enter" && teamName && createTeam()} />
              </div>
              <div className="flex justify-between">
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={back} disabled={busy}>← Back</Button>
                  <Button variant="ghost" onClick={() => setStep(3)} disabled={busy}>Skip</Button>
                </div>
                <Button onClick={createTeam} disabled={!teamName || busy}>{busy ? "Creating…" : "Create team →"}</Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">
                {assignmentId
                  ? "Create your first temporary inbox to start receiving emails."
                  : "No domain was configured. You can set one up later in Settings."}
              </p>
              <div className="flex justify-between">
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={back} disabled={busy}>← Back</Button>
                  <Button variant="ghost" onClick={() => setStep(4)} disabled={busy}>Skip</Button>
                </div>
                {assignmentId && (
                  <Button onClick={createInbox} disabled={busy}>{busy ? "Creating…" : "Create inbox →"}</Button>
                )}
                {!assignmentId && (
                  <Button onClick={() => setStep(4)}>Continue →</Button>
                )}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div className="text-center space-y-3">
                <span className="text-5xl">🎉</span>
                <p className="text-lg font-semibold">You&apos;re all set!</p>
                {inboxAddress && (
                  <div className="rounded bg-muted p-3">
                    <p className="text-sm text-muted-foreground">Your first inbox:</p>
                    <code className="text-sm font-medium">{inboxAddress}</code>
                  </div>
                )}
              </div>
              <Button onClick={finish} className="w-full" disabled={busy}>{busy ? "Loading…" : "Go to Dashboard"}</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
