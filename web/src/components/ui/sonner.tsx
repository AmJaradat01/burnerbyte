"use client"

import {
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2Icon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CheckCircle className="h-4 w-4 text-success" />,
        info: <Info className="h-4 w-4 text-info" />,
        warning: <AlertTriangle className="h-4 w-4 text-warning" />,
        error: <AlertCircle className="h-4 w-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
