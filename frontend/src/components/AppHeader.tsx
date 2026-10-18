import { ThermometerSun } from 'lucide-react'

export interface NavSection {
  id: string
  label: string
}

export type AppView = 'analyzer' | 'compare'

const VIEWS: { id: AppView; label: string }[] = [
  { id: 'analyzer', label: 'Analyze' },
  { id: 'compare', label: 'Compare' },
]

export function AppHeader({
  sections,
  view,
  onViewChange,
}: {
  sections: NavSection[]
  view?: AppView
  onViewChange?: (view: AppView) => void
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[88rem] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <a
          href="#top"
          className="flex min-h-14 shrink-0 items-center gap-2.5 rounded-md font-semibold tracking-tight text-foreground"
        >
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <ThermometerSun className="size-[1.125rem]" />
          </span>
          <span className="hidden sm:inline">Climate Hazard Trend Analyzer</span>
          <span className="sm:hidden">CHTA</span>
        </a>
        {view && onViewChange ? (
          <nav aria-label="Views" className="shrink-0">
            <ul className="flex items-center gap-1">
              {VIEWS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={view === item.id ? 'page' : undefined}
                    onClick={() => onViewChange(item.id)}
                    className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {sections.length > 0 ? (
          <nav aria-label="Result sections" className="-mx-1 min-w-0 flex-1 overflow-x-auto">
            <ul className="flex w-max items-center gap-1 px-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  )
}
