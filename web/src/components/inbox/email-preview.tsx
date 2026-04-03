"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/time";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  ArrowLeft, Code, Download, Eye, EyeOff, FileText, Globe, Paperclip, Trash2,
} from "lucide-react";
import type { Email, Attachment } from "@/types";

/* ── Avatar color (same algo as email-list) ── */

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
];

function avatarColor(email: string) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function senderName(email: string) {
  const local = email.split("@")[0] || "";
  return local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Sandboxed HTML with base styles ── */

function buildSandboxedHtml(html: string): string {
  const baseStyles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 16px; word-wrap: break-word; }
      img { max-width: 100%; height: auto; }
      a { color: #2563eb; }
      table { max-width: 100%; }
      pre { overflow-x: auto; background: #f5f5f5; padding: 12px; border-radius: 6px; }
    </style>
  `;
  // Inject base styles before closing </head> or at the start
  if (html.includes("</head>")) {
    return html.replace("</head>", `${baseStyles}</head>`);
  }
  return `${baseStyles}${html}`;
}

/* ── Props ── */

interface EmailPreviewProps {
  email: Email & { spam_score?: number; raw_headers?: string };
  onBack: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}

export function EmailPreview({ email, onBack, onToggleRead, onDelete }: EmailPreviewProps) {
  const color = avatarColor(email.from_address);
  const initial = email.from_address.charAt(0).toUpperCase();
  const name = senderName(email.from_address);
  const domain = email.from_address.split("@")[1] || "";
  const hasHtml = !!email.body_html;
  const [activeTab, setActiveTab] = useState(hasHtml ? "html" : "text");

  return (
    <>
      {/* Header */}
      <div className="shrink-0 border-b bg-background px-5 py-4">
        {/* Mobile back */}
        <button onClick={onBack} className="md:hidden flex items-center gap-1.5 text-xs text-muted-foreground mb-3 hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to list
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {/* Subject */}
            <h2 className="text-lg font-semibold leading-tight">{email.subject || "(no subject)"}</h2>

            {/* Sender info */}
            <div className="flex items-center gap-3 mt-3">
              <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold ${color}`}>
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
              variant="ghost" size="sm" className="h-8 w-8 p-0"
              title={email.is_read ? "Mark unread" : "Mark read"}
              onClick={onToggleRead}
            >
              {email.is_read ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
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
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
              <Paperclip className="h-3 w-3" /> {email.attachments.length} attachment{email.attachments.length > 1 ? "s" : ""}
            </span>
            {email.attachments.map((att) => (
              <AttachmentChip key={att.id} attachment={att} emailId={email.id} />
            ))}
          </div>
        )}
      </div>

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
              <iframe
                srcDoc={buildSandboxedHtml(email.body_html!)}
                title="Email content"
                className="w-full h-full min-h-[500px] border rounded-lg bg-white"
                sandbox=""
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
  const download = async () => {
    try {
      const res = await api.get<{ url: string }>(`/emails/${emailId}/attachments/${attachment.id}`);
      window.open(res.url, "_blank");
    } catch {
      toast.error("Failed to download");
    }
  };

  const sizeKB = Math.round(attachment.size_bytes / 1024);
  const isImage = attachment.content_type?.startsWith("image/");

  return (
    <button
      onClick={download}
      className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted transition-colors group"
    >
      <span className="text-muted-foreground">{isImage ? "🖼️" : "📄"}</span>
      <span className="truncate max-w-[140px] font-medium">{attachment.filename}</span>
      <span className="text-muted-foreground">({sizeKB > 0 ? `${sizeKB}KB` : `${attachment.size_bytes}B`})</span>
      <Download className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
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
