<script lang="ts">
  import * as m from './loclizr/messages'
  import { locale } from './locale.svelte'
</script>

<div>
  {#each m.locales as tag (tag)}
    <button type="button" aria-pressed={tag === locale.current} onclick={() => m.setLocale(tag)}>
      {tag}
    </button>
  {/each}
</div>
