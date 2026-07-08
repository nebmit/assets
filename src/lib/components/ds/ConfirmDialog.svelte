<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';

	/**
	 * Modal confirmation built on the native <dialog> element, which supplies
	 * the focus trap, Escape handling, top-layer stacking and aria-modal for
	 * free. Cancel is autofocused — confirming a consequential action should
	 * be a deliberate second movement, not the default Enter. Escape and a
	 * backdrop click both cancel.
	 */
	interface Props {
		open: boolean;
		title: string;
		confirmLabel: string;
		/** Disables both buttons while the confirm action runs (e.g. a passkey ceremony). */
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
		children: Snippet;
	}

	let { open, title, confirmLabel, busy = false, onconfirm, oncancel, children }: Props = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		const dialog = dialogEl;
		if (dialog === null) return;
		if (open && !dialog.open) {
			// showModal() focuses the first focusable element — Cancel, which
			// sits first in DOM order.
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	/** Escape (and any programmatic close) must settle the state back to cancelled. */
	function onclose(): void {
		if (open) oncancel();
	}

	function oncancelEvent(event: Event): void {
		// While busy the ceremony owns the flow; block Escape-closing.
		if (busy) event.preventDefault();
	}

	function onBackdropClick(event: MouseEvent): void {
		// The dialog element itself is only hit when the click lands on ::backdrop.
		if (event.target === dialogEl && !busy) oncancel();
	}
</script>

<dialog
	bind:this={dialogEl}
	class="m-auto w-[min(420px,calc(100vw-36px))] rounded-md border border-border-subtle bg-surface-card p-0 text-text-primary shadow-popover backdrop:bg-[rgba(15,15,17,0.35)]"
	aria-labelledby="confirm-dialog-title"
	{onclose}
	oncancel={oncancelEvent}
	onclick={onBackdropClick}
>
	<div class="flex flex-col gap-3 px-5 pt-[18px] pb-4">
		<h3 id="confirm-dialog-title" class="m-0 text-md font-medium tracking-tight">
			{title}
		</h3>
		<div class="flex flex-col gap-2 font-mono text-xs leading-relaxed text-text-tertiary">
			{@render children()}
		</div>
		<div class="mt-2 flex justify-end gap-2">
			<Button variant="secondary" disabled={busy} onclick={oncancel}>Cancel</Button>
			<Button variant="primary" disabled={busy} onclick={onconfirm}>
				{confirmLabel}
			</Button>
		</div>
	</div>
</dialog>
