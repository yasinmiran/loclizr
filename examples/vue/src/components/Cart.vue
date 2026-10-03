<script setup lang="ts">
import * as m from '../loclizr/messages'

defineProps<{ count: number }>()
</script>

<template>
  <p>{{ m.cart_items({ count }) }}</p>
</template>
