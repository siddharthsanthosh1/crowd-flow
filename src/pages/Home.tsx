import { Link } from 'react-router-dom'

export function Home() {
  return (
    <div className="mx-auto max-w-xl p-6 text-neutral-100">
      <h1 className="mb-2 text-3xl font-bold">CrowdFlow</h1>
      <p className="mb-6 text-neutral-400">
        Volunteers count people moving between areas by tapping a phone. Organizers see
        how full each area is, live.
      </p>
      <p className="mb-6 text-neutral-400">
        Volunteers do not come here — they scan the QR card at their post.
      </p>
      <Link to="/admin" className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white">
        Organizer setup
      </Link>
    </div>
  )
}
