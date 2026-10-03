<script setup lang="ts">
import App from './App.vue'
import { useLocale } from './useLocale'

const locale = useLocale()
</script>

<template>
  <App :key="locale" />
</template>
