"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-sm transition-all duration-200 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/20",
        "data-[size=default]:h-6 data-[size=default]:w-11",
        "data-[size=sm]:h-4 data-[size=sm]:w-7",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-md ring-0 transition-transform duration-200",
          "data-[state=checked]:data-[size=default]:translate-x-5 data-[state=unchecked]:translate-x-0.5",
          "data-[size=default]:size-5 data-[size=sm]:size-3",
          "data-[state=checked]:data-[size=sm]:translate-x-3"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
