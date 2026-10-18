import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva('relative flex gap-3 rounded-lg border p-4 text-sm leading-relaxed', {
  variants: {
    variant: {
      info: 'border-info-border bg-info-bg text-info-foreground',
      warning: 'border-warning-border bg-warning-bg text-warning-foreground',
      danger: 'border-danger-border bg-danger-bg text-danger-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
})

/**
 * The icon (passed in) carries the severity alongside the colour, so meaning never depends on colour alone.
 */
function Alert({
  className,
  variant,
  icon,
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants> & { icon?: React.ReactNode }) {
  return (
    <div className={cn(alertVariants({ variant }), className)} {...props}>
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('font-semibold text-foreground', className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-1 text-[0.9375rem]', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }
