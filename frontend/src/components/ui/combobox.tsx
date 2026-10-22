// @tw3-converted by scripts/tw4-to-tw3.mjs — do not re-run on this file
// R3: trigger + content for a searchable picker (Popover + Command), styled
// like SelectTrigger so a combobox and a Select read as one form.
import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { PopoverContent } from "@/components/ui/popover"

const ComboboxTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
  function ComboboxTrigger({ className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="combobox"
        data-slot="combobox-trigger"
        className={cn(
          "flex h-9 w-full items-center justify-between gap-1.5 rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-left text-sm whitespace-nowrap transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>
    )
  }
)

function ComboboxContent({ className, ...props }: React.ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      data-slot="combobox-content"
      className={cn("w-[var(--radix-popover-trigger-width)] p-0", className)}
      {...props}
    />
  )
}

export { ComboboxTrigger, ComboboxContent }
