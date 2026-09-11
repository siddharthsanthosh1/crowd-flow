import type { ReactNode } from 'react'

/** Plain full-screen message, used for loading and error states. */
export function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-[100svh] flex-col items-center justify-center bg-neutral-950 p-6 text-center">
      <h1 className="mb-3 text-2xl font-bold text-neutral-100">{title}</h1>
      <div className="max-w-sm text-neutral-300">{children}</div>
    </div>
  )
}
