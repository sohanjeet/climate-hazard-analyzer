import * as React from 'react'
import { cn } from '@/lib/utils'

const fieldClasses =
  'min-h-11 w-full rounded-md border border-input bg-surface px-3 text-base text-foreground shadow-none transition-[border-color,box-shadow] duration-150 ease-out-quart placeholder:text-muted-foreground/70 hover:border-foreground/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger-foreground aria-[invalid=true]:focus-visible:ring-danger-foreground/30'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(fieldClasses, className)} {...props} />
}

function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select className={cn(fieldClasses, 'appearance-auto pr-2', className)} {...props}>
      {children}
    </select>
  )
}

export { Input, Select }
