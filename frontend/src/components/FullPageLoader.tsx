export function FullPageLoader() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-sand"
      aria-live="polite"
    >
      <div className="text-center">
        <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-4 border-forest-200 border-t-forest-800" />
        <p className="mt-4 text-sm font-medium text-forest-800">
          Loading SmartFix…
        </p>
      </div>
    </main>
  )
}
