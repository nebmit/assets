<script lang="ts">
    import { hello_world } from "$lib/paraglide/messages";
    import { setLocale } from "$lib/paraglide/runtime";
</script>

<h1>{hello_world({ name: "World" })}</h1>
<br>
<button on:click={() => setLocale("en")}> English </button>
<button on:click={() => setLocale("ja")}> Japanese </button>
