import { useCallback, useEffect, useState } from 'react'

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof localStorage === 'undefined') return initial
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initial
      const parsed = JSON.parse(raw) as T
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && initial && typeof initial === 'object') {
        return { ...(initial as object), ...(parsed as object) } as T
      }
      return parsed
    } catch {
      return initial
    }
  })

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* storage may be unavailable */
    }
  }, [key, state])

  const update = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => (typeof value === 'function' ? (value as (p: T) => T)(prev) : value))
  }, [])

  return [state, update]
}
