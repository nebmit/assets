<script lang="ts">
    import Card from "./Card.svelte";
    import Icon from "./Icon.svelte";

    export let title: string;
    export let iconName: string;
</script>

<Card {title} showHeader={true}>
    <svelte:fragment slot="icon">
        <Icon name={iconName} />
    </svelte:fragment>

    <div class="space-y-4 text-base-content/80 leading-relaxed">
        <slot />
    </div>
</Card>
