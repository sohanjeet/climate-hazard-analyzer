import { Compass } from 'lucide-react'
import { Link } from '@/components/Link'
import { ROUTES } from '@/lib/router'
import { PageHeader } from '@/pages/PageHeader'

export default function NotFoundPage() {
  return (
    <div>
      <PageHeader title="Page not found" icon={Compass}>
        There is no page at this address. These are the pages of the app:
      </PageHeader>
      <ul className="mt-6 flex flex-col gap-2">
        {ROUTES.map((r) => (
          <li key={r.id}>
            <Link to={r.path} className="font-semibold text-primary underline underline-offset-4">{r.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
