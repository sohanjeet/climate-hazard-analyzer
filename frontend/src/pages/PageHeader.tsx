import type { LucideIcon } from 'lucide-react'

export function PageHeader({ title, icon: Icon, children }: { title: string; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl">
      <h1 className="flex items-center gap-3 font-display text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
        {Icon ? <Icon aria-hidden="true" className="size-8 shrink-0 text-heat sm:size-10" /> : null}
        {title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}
