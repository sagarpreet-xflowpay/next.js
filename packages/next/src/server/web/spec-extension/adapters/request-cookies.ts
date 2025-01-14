import type { RequestCookies } from '../cookies'
import type { BaseNextResponse } from '../../../base-http'
import type { ServerResponse } from 'http'

import { ReflectAdapter } from './reflect'

/**
 * @internal
 */
export class ReadonlyRequestCookiesError extends Error {
  constructor() {
    super(
      'ReadonlyRequestCookies cannot be modified. Read more: https://nextjs.org/docs/api-reference/cookies'
    )
  }

  public static callable() {
    throw new ReadonlyRequestCookiesError()
  }
}

export type ReadonlyRequestCookies = Omit<
  RequestCookies,
  'clear' | 'delete' | 'set'
>

export class RequestCookiesAdapter {
  public static seal(cookies: RequestCookies): ReadonlyRequestCookies {
    return new Proxy(cookies, {
      get(target, prop, receiver) {
        switch (prop) {
          case 'clear':
          case 'delete':
          case 'set':
            return ReadonlyRequestCookiesError.callable
          default:
            return ReflectAdapter.get(target, prop, receiver)
        }
      },
    })
  }
}

export const SYMBOL_MODIFY_COOKIE_VALUES = Symbol.for('next.mutated.cookies')

export class MutableRequestCookiesAdapter {
  public static seal(
    cookies: RequestCookies,
    res: ServerResponse | BaseNextResponse | undefined
  ): RequestCookies {
    let modifiedValues: [string, string][] = []
    const modifiedCookies = new Set<string>()
    const updateResponseCookies = () => {
      const allCookies = cookies.getAll()
      modifiedValues = allCookies
        .filter((c) => modifiedCookies.has(c.name))
        .map((c) => [c.name, c.value])
      if (res) {
        res.setHeader(
          'Set-Cookie',
          modifiedValues.map((c) => `${c[0]}=${c[1]}`)
        )
      }
    }

    return new Proxy(cookies, {
      get(target, prop, receiver) {
        switch (prop) {
          // A special symbol to get the modified cookie values
          case SYMBOL_MODIFY_COOKIE_VALUES:
            return modifiedValues

          // TODO: Throw error if trying to set a cookie after the response
          // headers have been set.
          case 'clear':
            return function () {
              for (const c of cookies.getAll()) {
                modifiedCookies.add(c.name)
              }
              try {
                return cookies.clear()
              } finally {
                updateResponseCookies()
              }
            }
          case 'delete':
            return function (names: string | string[]) {
              if (Array.isArray(names)) {
                names.forEach((name) => modifiedCookies.add(name))
              } else {
                modifiedCookies.add(names)
              }
              try {
                return cookies.delete(names)
              } finally {
                updateResponseCookies()
              }
            }
          case 'set':
            return function (
              ...args:
                | [string, string]
                | [
                    options: NonNullable<
                      ReturnType<InstanceType<typeof RequestCookies>['get']>
                    >
                  ]
            ) {
              const [key, value] = args
              if (typeof key === 'string') {
                modifiedCookies.add(key)
                try {
                  return cookies.set(key, value!)
                } finally {
                  updateResponseCookies()
                }
              }
              modifiedCookies.add(key.name)
              try {
                return cookies.set(key)
              } finally {
                updateResponseCookies()
              }
            }
          default:
            return ReflectAdapter.get(target, prop, receiver)
        }
      },
    })
  }
}
