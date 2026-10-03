import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../data/client'

export type AsyncState<T> = {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  setData: (value: T | null) => void
}

type InnerState<T> = { data: T | null; loading: boolean; error: string | null }

/**
 * Ejecuta una carga de datos al montar y cuando cambian las dependencias.
 * `deps` se usa igual que en useEffect.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<InnerState<T>>({ data: null, loading: true, error: null })
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)

  // El loader más reciente se guarda en un ref (sólo fuera del render).
  useEffect(() => {
    loaderRef.current = loader
  })

  useEffect(() => {
    let active = true

    loaderRef
      .current()
      .then((value) => {
        if (!active) return
        setState({ data: value, loading: false, error: null })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setState({ data: null, loading: false, error: errorMessage(cause) })
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  const setData = useCallback((value: T | null) => {
    setState((current) => ({ ...current, data: value }))
  }, [])

  return { ...state, reload, setData }
}

/** Ejecuta una acción con estado de "en curso" y error amigable. */
export function useAction<Args extends unknown[], R>(
  action: (...args: Args) => Promise<R>,
): {
  run: (...args: Args) => Promise<R | undefined>
  pending: boolean
  error: string | null
  clearError: () => void
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (...args: Args) => {
      setPending(true)
      setError(null)
      try {
        return await action(...args)
      } catch (cause) {
        setError(errorMessage(cause))
        return undefined
      } finally {
        setPending(false)
      }
    },
    [action],
  )

  const clearError = useCallback(() => setError(null), [])

  return { run, pending, error, clearError }
}
