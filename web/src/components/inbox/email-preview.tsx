"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/time";
import { buildSandboxedHtml, hasRemoteContent } from "@/lib/email-html";
import { extractVerificationCode } from "@/lib/verification-code";
import { copyToClipboard } from "@/lib/clipboard";
import { api, getAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  ArrowLeft, Check, Code, Copy, Download, FileText, Globe, Image as ImageIcon, ImageOff, KeyRound, Mail, MailOpen, Paperclip, Trash2,
} from "lucide-react";
import type { Email, Attachment } from "@/types";

function senderName(email: string) {
  const local = email.split("@")[0] || "";
  return local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Props ── */

interface EmailPreviewProps {
  email: Email & { spam_score?: number; raw_headers?: string };
  onBack: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}

export function EmailPreview({ email, onBack, onToggleRead, onDelete }: EmailPreviewProps) {
  const initial = email.from_address.charAt(0).toUpperCase();
  const name = senderName(email.from_address);
  const hasHtml = !!email.body_html;
  const [activeTab, setActiveTab] = useState(hasHtml ? "html" : "text");
  // Remote images are blocked by default (tracking-pixel / IP-leak protection);
  // the reader opts in per email. Reset on email change via the render-time
  // adjustment pattern (no effect, no flash of the previous email's choice).
  const [showRemote, setShowRemote] = useState(false);
  const [seenEmailId, setSeenEmailId] = useState(email.id);
  if (email.id !== seenEmailId) {
    setSeenEmailId(email.id);
    setShowRemote(false);
  }
  const remoteBlocked = hasHtml && !showRemote && hasRemoteContent(email.body_html!);

  // Surface a likely one-time / verification code (common for the signup-flow
  // testing this tool is built for). Reset the "copied" state per email.
  const verificationCode = extractVerificationCode([email.subject, email.body_text].filter(Boolean).join("  "));
  const [codeCopied, setCodeCopied] = useState(false);
  if (email.id !== seenEmailId && codeCopied) setCodeCopied(false);
  const copyCode = () => {
    if (!verificationCode) return;
    copyToClipboard(verificationCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  };

  return (
    <>
      {/* Header */}
      <div className="shrink-0 bg-background px-5 py-4 border-b border-border">
        {/* Mobile back */}
        <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-xs text-muted-foreground mb-3 hover:text-foreground transition-colors duration-150">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to list
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {/* Subject */}
            <h2 className="text-lg font-semibold leading-tight">{email.subject || "(no subject)"}</h2>

            {/* Sender info */}
            <div className="flex items-center gap-3 mt-3">
              <div className="shrink-0 h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-bold">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{name}</p>
                  <span className="text-xs text-muted-foreground truncate">&lt;{email.from_address}&gt;</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  to {email.to_address} · {formatDate(email.received_at)}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0 pt-1">
            <Button
              variant={email.is_read ? "ghost" : "outline"} size="sm"
              className={`h-8 gap-1.5 text-xs px-2.5 ${!email.is_read ? "border-primary/30 text-primary" : ""}`}
              aria-label={email.is_read ? "Mark as unread" : "Mark as read"}
              onClick={onToggleRead}
            >
              {email.is_read ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
              <span className="hidden sm:inline" aria-hidden="true">{email.is_read ? "Mark unread" : "Mark read"}</span>
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" aria-label="Delete email">
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
              title="Delete email?"
              description="This email and its attachments will be permanently deleted."
              onConfirm={onDelete}
            />
          </div>
        </div>

        {/* Attachments */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t bg-muted/20 -mx-5 px-5 pb-3 rounded-b-lg">
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
              <Paperclip className="h-3 w-3" /> {email.attachments.length} attachment{email.attachments.length > 1 ? "s" : ""}
            </span>
            {email.attachments.map((att) => (
              <AttachmentChip key={att.id} attachment={att} emailId={email.id} />
            ))}
          </div>
        )}
      </div>

      {verificationCode && (
        <div className="shrink-0 px-5 pb-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-xs text-muted-foreground">Verification code</span>
              <span className="font-mono text-base font-semibold tracking-[0.2em] tabular-nums">{verificationCode}</span>
            </div>
            <button
              type="button"
              onClick={copyCode}
              aria-label="Copy verification code"
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary/10"
            >
              {codeCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {codeCopied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Body with tabs */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 px-5 pt-3">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList variant="line" className="h-8">
              {hasHtml && (
                <TabsTrigger value="html" className="text-xs gap-1.5 px-3">
                  <Globe className="h-3 w-3" /> HTML
                </TabsTrigger>
              )}
              <TabsTrigger value="text" className="text-xs gap-1.5 px-3">
                <FileText className="h-3 w-3" /> Plain Text
              </TabsTrigger>
              <TabsTrigger value="headers" className="text-xs gap-1.5 px-3">
                <Code className="h-3 w-3" /> Headers
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "html" && hasHtml && (
            <div className="p-5 h-full">
              {remoteBlocked && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ImageOff className="h-3.5 w-3.5 shrink-0" />
                    Remote images blocked to protect your privacy.
                  </span>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => setShowRemote(true)}>
                    Load images
                  </Button>
                </div>
              )}
              <iframe
                srcDoc={buildSandboxedHtml(email.body_html!, !showRemote)}
                title="Email content"
                className="w-full h-full min-h-[500px] border rounded-lg bg-white"
                sandbox="allow-popups"
              />
            </div>
          )}
          {activeTab === "text" && (
            <div className="p-5">
              <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground bg-muted/30 rounded-lg p-4">
                {email.body_text || "(empty body)"}
              </pre>
            </div>
          )}
          {activeTab === "headers" && (
            <div className="p-5">
              <pre className="whitespace-pre-wrap text-xs font-mono leading-relaxed text-muted-foreground bg-muted/30 rounded-lg p-4 max-h-[500px] overflow-auto">
                {typeof email.raw_headers === "string"
                  ? email.raw_headers
                  : email.raw_headers
                    ? JSON.stringify(email.raw_headers, null, 2)
                    : "(no headers available)"}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Attachment chip ── */

function AttachmentChip({ attachment, emailId }: { attachment: Attachment; emailId: string }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get<{ url: string }>(`/emails/${emailId}/attachments/${attachment.id}`);
      if (!res.url.startsWith('http://') && !res.url.startsWith('https://')) {
        toast.error('Invalid download URL');
        return;
      }
      // Local-FS URLs (/api/v1/files) require the JWT — browser anchor navigation
      // can't carry the Authorization header, so we fetch+blob instead. MinIO
      // presigned URLs are self-contained credentials; direct anchor is fine.
      if (res.url.includes('/api/v1/files')) {
        const token = getAccessToken();
        const resp = await fetch(res.url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) { toast.error("Failed to download"); return; }
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = attachment.filename;
        a.click();
        URL.revokeObjectURL(blobUrl);
      } else {
        const a = document.createElement("a");
        a.href = res.url;
        a.download = attachment.filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      toast.error("Failed to download");
    } finally {
      setDownloading(false);
    }
  };

  const sizeKB = Math.round(attachment.size_bytes / 1024);
  const isImage = attachment.content_type?.startsWith("image/");
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <button
      onClick={download}
      disabled={downloading}
      className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted transition-colors duration-150 group disabled:opacity-50"
      aria-label={`Download ${attachment.filename}`}
    >
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="truncate max-w-[140px] font-medium">{attachment.filename}</span>
      <span className="text-muted-foreground">({sizeKB > 0 ? `${sizeKB}KB` : `${attachment.size_bytes}B`})</span>
      <Download className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors duration-150 shrink-0" />
    </button>
  );
}

/* ── Date formatter ── */

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  if (diffMs < 86400000) {
    return timeAgo(dateStr);
  }
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: now.getFullYear() !== d.getFullYear() ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}
