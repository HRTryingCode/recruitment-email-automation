// @tw3-converted by scripts/tw4-to-tw3.mjs — do not re-run on this file
import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[calc(0.25rem*var(--gap))] data-[variant=outline]:data-[spacing=0]:rounded-3xl data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-3 group-data-[spacing=0]/toggle-group:shadow-none focus:z-10 focus-visible:z-10 has-[[data-icon=inline-end]]:group-data-[spacing=0]/toggle-group:pr-2.5 has-[[data-icon=inline-start]]:group-data-[spacing=0]/toggle-group:pl-2.5 first:data-[spacing=0]:group-data-[orientation=horizontal]/toggle-group:rounded-l-3xl first:data-[spacing=0]:group-data-[orientation=vertical]/toggle-group:rounded-t-3xl last:data-[spacing=0]:group-data-[orientation=horizontal]/toggle-group:rounded-r-3xl last:data-[spacing=0]:group-data-[orientation=vertical]/toggle-group:rounded-b-3xl data-[state=on]:bg-muted data-[variant=outline]:data-[spacing=0]:group-data-[orientation=horizontal]/toggle-group:border-l-0 data-[variant=outline]:data-[spacing=0]:group-data-[orientation=vertical]/toggle-group:border-t-0 first:data-[variant=outline]:data-[spacing=0]:group-data-[orientation=horizontal]/toggle-group:border-l first:data-[variant=outline]:data-[spacing=0]:group-data-[orientation=vertical]/toggle-group:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
