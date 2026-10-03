import { defineMiddleware } from 'astro:middleware'
import { runWithLocale } from 'loclizr/server'

export const onRequest = defineMiddleware((context, next) => {
  const { lang } = context.params
  return lang === undefined ? next() : runWithLocale(lang, next)
})
