<script lang="ts" module>
  import type { IconComponent } from "./types";

  export interface Column {
    key: string;
    label: string;
    align?: "left" | "right" | "center";
    /** Header icon (Figma finals table). */
    icon?: IconComponent;
    /** Extra classes for this column's cells. */
    class?: string;
  }
</script>

<script lang="ts" generics="Row">
  import type { Snippet } from "svelte";

  let {
    columns,
    rows,
    caption,
    variant = "well",
    title,
    cell,
    empty = "Nothing to show",
    rowKey,
    class: className = "",
  }: {
    columns: readonly Column[];
    rows: readonly Row[];
    /** Describes the table for screen readers. */
    caption: string;
    /** well: FCE style (gray well, bold headers, no rules); outline: in a card (bordered, header rule). */
    variant?: "well" | "outline";
    /** Optional heading inside the well, such as "Aggregate Data". */
    title?: Snippet;
    /** Custom cell renderer; defaults to the row's value at the column key. */
    cell?: Snippet<[Row, Column]>;
    empty?: string;
    rowKey?: (row: Row, index: number) => string | number;
    class?: string;
  } = $props();

  function text(row: Row, column: Column): string {
    const value = (row as Record<string, unknown>)[column.key];
    if (value === null || value === undefined) return "";
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  }

  const aligns = { left: "text-left", right: "text-right", center: "text-center" };
</script>

<div
  class="{variant === 'well'
    ? 'rounded-card bg-surface-2 px-4 pt-4 pb-3 sm:px-6 sm:pt-5'
    : 'overflow-hidden rounded-card border border-pressed bg-surface'} {className}"
>
  {#if title}<div class="mb-3">{@render title()}</div>{/if}
  <div class="data-table-scroll {variant === 'well' ? 'pb-3' : ''}">
    <table class={variant === "well" ? "data-table" : "data-table-outline"}>
      <caption class="sr-only">{caption}</caption>
      <thead>
        <tr>
          {#each columns as column (column.key)}
            <th scope="col" class={aligns[column.align ?? "left"]}>
              {#if column.icon}
                <span class="inline-flex items-center gap-2">
                  <column.icon aria-hidden="true" class="size-4" />{column.label}
                </span>
              {:else}
                {column.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, index (rowKey ? rowKey(row, index) : index)}
          <tr>
            {#each columns as column (column.key)}
              <td class="{aligns[column.align ?? 'left']} {column.class ?? ''}">
                {#if cell}{@render cell(row, column)}{:else}{text(row, column)}{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if rows.length === 0}
    <p class="px-6 py-6 text-center text-body-2 text-muted">{empty}</p>
  {/if}
</div>
