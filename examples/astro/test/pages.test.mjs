import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const expected = {
  de: '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Warenkorb</title></head><body><h1>Hallo Ada, dein Warenkorb ist bereit</h1><p>3 Artikel in deinem Warenkorb</p></body></html>',
  en: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Cart</title></head><body><h1>Hi Ada, your cart is ready</h1><p>3 items in your cart</p></body></html>',
}

for (const [lang, html] of Object.entries(expected)) {
  test(`dist/${lang}/index.html renders in ${lang}`, async () => {
    const page = await readFile(new URL(`../dist/${lang}/index.html`, import.meta.url), 'utf8')
    assert.equal(page.trimEnd(), html)
  })
}
