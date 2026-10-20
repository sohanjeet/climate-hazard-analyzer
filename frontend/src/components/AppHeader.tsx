import { useEffect, useId, useRef, useState } from 'react'
import { Menu, Monitor, Moon, Sun, ThermometerSun, X } from 'lucide-react'
import { THEME_ORDER, type ThemePreference } from '@/hooks/useTheme'
import { Link } from '@/components/Link'
import { ROUTES, type RouteId } from '@/lib/router'

export interface NavSection {
  id: string
  label: string
}

const THEME_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const

const LINK =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground'

function ThemeButton({ preference, onChange }: { preference: ThemePreference; onChange: (next: ThemePreference) => void }) {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length]
  const Icon = THEME_ICON[preference]
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={`Colour theme: ${THEME_LABEL[preference]}. Switch to ${THEME_LABEL[next]}`}
      title={`Theme: ${THEME_LABEL[preference]}`}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon aria-hidden="true" className="size-[1.125rem]" />
    </button>
  )
}

export function AppHeader({
  sections,
  route,
  theme,
  onThemeChange,
}: {
  sections: NavSection[]
  route: RouteId
  theme: ThemePreference
  onThemeChange: (next: ThemePreference) => void
}) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      menuButton.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !menuButton.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const links = (onNavigate?: () => void) =>
    ROUTES.map((item) => (
      <li key={item.id}>
        <Link to={item.path} aria-current={route === item.id ? 'page' : undefined} className={`${LINK} w-full`} onNavigate={onNavigate}>
          {item.label}
        </Link>
      </li>
    ))

  return (
    <header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex min-h-14 shrink-0 items-center gap-2.5 rounded-md font-semibold tracking-tight text-foreground">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <ThermometerSun className="size-[1.125rem]" />
          </span>
          <span className="hidden sm:inline xl:hidden 2xl:inline">Climate Hazard Trend Analyzer</span>
          <span className="sm:hidden xl:inline 2xl:hidden">CHTA</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden xl:block">
          <ul className="flex items-center gap-0.5">{links()}</ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 xl:ml-0">
          <ThemeButton preference={theme} onChange={onThemeChange} />
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-foreground hover:bg-muted xl:hidden"
          >
            {open ? <X aria-hidden="true" className="size-4" /> : <Menu aria-hidden="true" className="size-4" />}
            Menu
          </button>
        </div>
      </div>

      <div ref={panel} id={menuId} hidden={!open} className="border-t bg-background xl:hidden">
        <nav aria-label="Main menu" className="mx-auto max-w-[88rem] px-4 py-2 sm:px-6 lg:px-8">
          <ul className="grid gap-0.5 sm:grid-cols-2">{links(() => setOpen(false))}</ul>
        </nav>
      </div>

      {sections.length > 0 ? (
        <div className="border-t">
          <nav aria-label="Result sections" className="mx-auto max-w-[88rem] overflow-x-auto px-3 sm:px-5 lg:px-7">
            <ul className="flex w-max items-center gap-1 px-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
    </header>
  )
}
