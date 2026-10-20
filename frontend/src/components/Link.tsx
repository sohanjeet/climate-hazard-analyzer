import { cn } from '@/lib/utils'
import { navigate } from '@/lib/router'

/** An anchor with a real href (new tab, copy link still work) whose plain clicks navigate in-page. */
export function Link({
  to,
  className,
  children,
  onNavigate,
  onClick,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & { to: string; onNavigate?: () => void }) {
  return (
    <a
      {...props}
      href={to}
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(to)
        window.scrollTo({ top: 0 })
        onNavigate?.()
      }}
    >
      {children}
    </a>
  )
}
