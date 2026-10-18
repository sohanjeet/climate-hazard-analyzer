import { cn } from '@/lib/utils'

/** Placeholder block. Decorative: screen readers hear the loading status announced elsewhere. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-md bg-[linear-gradient(90deg,var(--muted)_25%,color-mix(in_oklch,var(--muted),var(--foreground)_7%)_50%,var(--muted)_75%)] bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
