"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface Webhook {
  id: string;
  team_id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

export default function WebhooksPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["webhooks", currentTeam?.id],
    queryFn: () => api.get<{ data: Webhook[] }>(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/webhooks`),
    enabled: !!currentOrg && !!currentTeam,
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/webhooks/${id}`, { is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks"] }); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/webhooks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks"] }); toast.success("Webhook deleted"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (!currentTeam) return <p className="text-muted-foreground">Select a team first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Webhooks</h1>
        <CreateWebhookDialog orgId={currentOrg!.id} teamId={currentTeam.id} />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data?.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-sm max-w-xs truncate">{w.url}</TableCell>
                  <TableCell>{w.events?.map((e) => <Badge key={e} variant="outline" className="mr-1">{e}</Badge>)}</TableCell>
                  <TableCell>
                    <Switch checked={w.is_active} onCheckedChange={(v) => toggle.mutate({ id: w.id, is_active: v })} />
                  </TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => remove.mutate(w.id)}>Delete</Button></TableCell>
                </TableRow>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <TableRow><TableCell colSpan={4} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">🔗</span>
                    <p className="text-muted-foreground">No webhooks</p>
                    <p className="text-xs text-muted-foreground">Create a webhook to receive email delivery notifications.</p>
                  </div>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateWebhookDialog({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["email.received"]);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const allEvents = ["email.received", "inbox.created", "inbox.expired"];

  const toggleEvent = (event: string) => {
    setEvents((prev) => prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]);
  };

  const create = async () => {
    try {
      await api.post(`/orgs/${orgId}/teams/${teamId}/webhooks`, { url, events });
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success("Webhook created");
      setOpen(false);
      setUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Add webhook</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create webhook</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhook" />
          </div>
          <div className="space-y-2">
            <Label>Events</Label>
            <div className="flex flex-wrap gap-2">
              {allEvents.map((e) => (
                <Badge
                  key={e}
                  variant={events.includes(e) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleEvent(e)}
                >
                  {e}
                </Badge>
              ))}
            </div>
          </div>
          <Button onClick={create} className="w-full" disabled={!url}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
