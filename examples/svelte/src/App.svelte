<script lang="ts">
  import * as m from './loclizr/messages'
  import { locale } from './locale.svelte'
  import Cart from './Cart.svelte'
  import Switcher from './Switcher.svelte'
</script>

<Switcher />
{#key locale.current}
  <h1>{m.cart_greeting({ name: 'Ada' })}</h1>
{/key}
<Cart />
