<script lang="ts">
  import * as m from './loclizr/messages'
  import { locale } from './locale.svelte'

  let count = $state(3)
  const items = $derived(m.cart_items({ count }, { locale: locale.current }))
</script>

<p>{items}</p>
<button type="button" onclick={() => count++}>+1</button>
