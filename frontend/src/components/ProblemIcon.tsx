import { CircleDot, Droplets, Footprints, Lightbulb, Wrench, type LucideProps } from 'lucide-react'

const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  pothole: CircleDot,
  streetlight: Lightbulb,
  water_leak: Droplets,
  sidewalk_crack: Footprints,
  other: Wrench,
}

export function ProblemIcon({ code, ...props }: { code: string } & LucideProps) {
  const Icon = ICONS[code] ?? Wrench
  return <Icon {...props} />
}
