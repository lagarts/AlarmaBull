/** Logo de la app (public/logo.png). `alt` vacío = decorativo. */
export function AppLogo({ className = 'h-10 w-10', alt = '' }: { className?: string; alt?: string }) {
  return <img src="/logo.png" alt={alt} className={`object-contain ${className}`} />
}
