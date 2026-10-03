<script setup lang="ts">
import { computed } from 'vue'
import Cart from './components/Cart.vue'
import * as m from './loclizr/messages'
import { useLocale } from './useLocale'

const locale = useLocale()
const greeting = computed(() => m.cart_greeting({ name: 'Ada' }, { locale: locale.value }))
</script>

<template>
  <nav>
    <button
      v-for="tag in m.locales"
      :key="tag"
      type="button"
      :aria-pressed="tag === locale"
      @click="m.setLocale(tag)"
    >
      {{ tag }}
    </button>
  </nav>
  <h1>{{ greeting }}</h1>
  <Cart :count="3" />
</template>
