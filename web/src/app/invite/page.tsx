"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function InvitePage() {
  const params = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"pending" | "accepted" | "error">("pending");

  const accept = async () => {
    try {
      await api.post("/invites/accept", { token });
      setStatus("accepted");
      toast.success("Invite accepted");
    } catch (err) {
      setStatus("error");
      toast.error(err instanceof Error ? err.message : "Failed to accept invite");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{status === "accepted" ? "Welcome!" : status === "error" ? "Invite failed" : "You've been invited"}</CardTitle>
          <CardDescription>
            {status === "pending" && "Click below to accept the invitation and join the organization."}
            {status === "accepted" && "You have joined the organization."}
            {status === "error" && "This invite link is invalid or expired."}
          </CardDescription>
        </CardHeader>
        {status === "pending" && (
          <CardContent><Button onClick={accept} className="w-full">Accept invite</Button></CardContent>
        )}
        <CardFooter>
          <Link href="/inboxes" className="text-sm text-muted-foreground hover:underline">Go to dashboard</Link>
        </CardFooter>
      </Card>
    </div>
  );
}
