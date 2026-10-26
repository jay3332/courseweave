<script lang="ts">
  import {
    BookOpen,
    Bookmark,
    CalendarCheck,
    CalendarDays,
    Clock,
    Coins,
    Globe,
    GraduationCap,
    Layers,
    MonitorSmartphone,
  } from "@lucide/svelte";
  import RailGroup from "$lib/components/layout/RailGroup.svelte";
  import RailSection from "$lib/components/layout/RailSection.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import MultiSelect from "$lib/components/ui/MultiSelect.svelte";
  import RangeSlider from "$lib/components/ui/RangeSlider.svelte";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import ToggleChips, { type ToggleChip } from "$lib/components/ui/ToggleChips.svelte";
  import { toggleCircle } from "$lib/components/ui/styles";
  import type { Option } from "$lib/components/ui/types";
  import FceAggregateSettings from "$lib/components/course/FceAggregateSettings.svelte";
  import type { Department } from "$lib/core/data";
  import { FCE_HOURS_HELP } from "$lib/core/fce";
  import {
    MAX_HOURS_RANGE,
    MIN_RATING_RANGE,
    type Filters,
    type Level,
  } from "$lib/core/explorer/filters";
  import { DAY_LETTERS, DAY_LONG, formatTime } from "$lib/core/time";
  import type { Day, MiniMeta } from "$lib/core/types";
  import { SEASONS, UNITS_MAX, UNITS_MIN, type ExplorerQuery, type ExtraFilters, type Season } from "./query";
  import FilterSlider from "./FilterSlider.svelte";
  import RequirementFilter from "./RequirementFilter.svelte";

  let {
    query,
    onchange,
    onreset,
    departments,
    minis = [],
    termName = null,
    fceAvailable = false,
    signedIn = false,
    cards = true,
  }: {
    query: ExplorerQuery;
    onchange: (next: ExplorerQuery) => void;
    onreset: () => void;
    departments: readonly Department[];
    /** The semester's minis, for the session filter. */
    minis?: readonly MiniMeta[];
    /** The semester's name; null in the all-semesters view, which has no sections to filter by. */
    termName?: string | null;
    /** FCE summaries loaded: show the workload and rating filters. */
    fceAvailable?: boolean;
    signedIn?: boolean;
    /** Cards are showing: offer the options for their FCE aggregate. */
    cards?: boolean;
  } = $props();

  const f = $derived(query.filters);
  const extra = $derived(query.extra);
  const sections = $derived(termName !== null);

  function set<K extends keyof Filters>(key: K, value: Filters[K]): void {
    onchange({ ...query, filters: { ...query.filters, [key]: value } });
  }

  function setExtra(patch: Partial<ExtraFilters>): void {
    onchange({ ...query, extra: { ...query.extra, ...patch } });
  }

  const departmentOptions = $derived(
    departments.map(
      (d): Option => ({
        value: d.code,
        label: d.name,
        description: `${d.prefixes.join(" ")} \u00B7 ${d.courseCount} ${d.courseCount === 1 ? "course" : "courses"}`,
        keywords: `${d.code} ${d.prefixes.join(" ")}`,
      }),
    ),
  );

  const unitPresets = [
    { label: "6 Units", low: 6, high: 6 },
    { label: "9 Units", low: 9, high: 9 },
    { label: "12 Units", low: 12, high: 12 },
    { label: "15 Units", low: 15, high: 15 },
  ];

  const seasonOptions: Option[] = SEASONS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));

  const levelOptions: Option[] = [
    { value: "U", label: "Undergraduate" },
    { value: "G", label: "Graduate" },
    ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => ({ value: n, label: `${n}00 level` })),
  ];
  const levelValue = $derived(extra.number ?? (f.levels.length === 1 ? (f.levels[0] ?? "") : ""));

  function setLevel(value: string): void {
    if (value === "U" || value === "G") {
      onchange({ ...query, filters: { ...f, levels: [value as Level] }, extra: { ...extra, number: null } });
    } else {
      onchange({ ...query, filters: { ...f, levels: [] }, extra: { ...extra, number: value === "" ? null : value } });
    }
  }

  const TIME_OPTIONS: Option[] = Array.from({ length: (23 - 7) * 2 + 1 }, (_, i) => {
    const minutes = 7 * 60 + i * 30;
    return { value: String(minutes), label: formatTime(minutes) };
  });

  function toggleDay(day: Day): void {
    const days = f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day].toSorted((a, b) => a - b);
    set("days", days);
  }

  // "Full" keeps the chips on one line in the narrowest rail; it's announced as "Full semester".
  const sessionOptions = $derived<ToggleChip[]>([
    { value: "full", label: "Full", fullLabel: "Full semester" },
    ...minis.map((m) => ({ value: String(m.number), label: m.name })),
  ]);

</script>

<RailGroup>
  <div class="flex flex-col gap-3">
    <Switch
      label="Saved courses only"
      icon={Bookmark}
      checked={f.saved}
      onchange={(on) => set("saved", on)}
      class="w-full justify-between"
    />
    {#if sections}
      <Switch
        label="Fits my schedule"
        icon={CalendarCheck}
        checked={f.fits}
        onchange={(on) => set("fits", on)}
        class="w-full justify-between"
      />
    {/if}
  </div>

  <RailSection title="Department" icon={GraduationCap} badge={f.depts.length}>
    <MultiSelect
      options={departmentOptions}
      bind:value={() => f.depts, (next) => set("depts", next)}
      label="Departments"
      placeholder="Any department"
      searchPlaceholder="Find a department"
    />
  </RailSection>

  <RailSection title="Units" icon={Coins}>
    <RangeSlider
      label="Units"
      min={UNITS_MIN}
      max={UNITS_MAX}
      bind:low={() => extra.unitsLow, (low) => setExtra({ unitsLow: low })}
      bind:high={() => extra.unitsHigh, (high) => setExtra({ unitsHigh: high })}
      presets={unitPresets}
    />
    <!-- Courseweave's VAR units chip: research, independent study and other courses with units set per student. -->
    <Checkbox
      label="Variable units only"
      checked={f.units.includes("var")}
      onchange={(event) =>
        set("units", event.currentTarget.checked ? ["var"] : f.units.filter((u) => u !== "var"))}
      class="-ml-2"
    />
  </RailSection>

  <RailSection title="Offered in" icon={CalendarDays}>
    <ToggleChips
      label="Seasons it's offered in"
      options={seasonOptions}
      stretch
      bind:value={() => extra.seasons, (next) => setExtra({ seasons: next as Season[] })}
    />
  </RailSection>

  <RailSection title="Course Level" icon={BookOpen}>
    <Select
      label="Course level"
      placeholder="Any level"
      options={[{ value: "", label: "Any level" }, ...levelOptions]}
      bind:value={() => levelValue, setLevel}
    />
  </RailSection>

  <RailSection title="Requirement" icon={Globe} badge={f.req ? 1 : 0}>
    <RequirementFilter value={f.req} onchange={(next) => set("req", next)} />
  </RailSection>

  <Button variant="secondary" full onclick={onreset}>Reset</Button>
</RailGroup>

{#if sections}
  <RailGroup title="Schedule">
    <RailSection title="Days" icon={CalendarDays} badge={f.days.length}>
      <!-- Seven circles spread across the rail, the first and last on its edges like the control under them. -->
      <div role="group" aria-label="Days" class="flex justify-between gap-1">
        {#each DAY_LETTERS as letter, index (letter)}
          {@const day = index as Day}
          <button
            type="button"
            class={toggleCircle}
            aria-pressed={f.days.includes(day)}
            aria-label={DAY_LONG[day]}
            title={DAY_LONG[day]}
            onclick={() => toggleDay(day)}>{letter}</button
          >
        {/each}
      </div>
      <SegmentedControl
        label="Day matching"
        size="sm"
        full
        options={[
          { value: "only", label: "Only these days" },
          { value: "any", label: "Any of these" },
        ]}
        bind:value={() => f.dayMode, (next) => set("dayMode", next === "any" ? "any" : "only")}
      />
    </RailSection>

    <RailSection title="Time" icon={Clock} badge={(f.after === null ? 0 : 1) + (f.before === null ? 0 : 1)}>
      <div class="grid grid-cols-2 gap-2">
        <Select
          label="Starts at or after"
          hideLabel={false}
          options={[{ value: "", label: "Any time" }, ...TIME_OPTIONS]}
          bind:value={() => (f.after === null ? "" : String(f.after)), (next) => set("after", next === "" ? null : Number(next))}
        />
        <Select
          label="Ends by"
          hideLabel={false}
          options={[{ value: "", label: "Any time" }, ...TIME_OPTIONS]}
          bind:value={() => (f.before === null ? "" : String(f.before)), (next) => set("before", next === "" ? null : Number(next))}
        />
      </div>
    </RailSection>

    {#if minis.length > 0}
      <RailSection title="Session" icon={Layers} badge={f.sessions.length}>
        <ToggleChips
          label="Session"
          options={sessionOptions}
          bind:value={() => f.sessions, (next) => set("sessions", next)}
          stretch
        />
      </RailSection>
    {/if}

    <RailSection title="Delivery" icon={MonitorSmartphone} badge={f.delivery.length}>
      <ToggleChips
        label="Delivery"
        options={[
          { value: "inperson", label: "In person" },
          { value: "remote", label: "Remote" },
        ]}
        stretch
        bind:value={
          () => f.delivery,
          (next) => set("delivery", next.filter((d) => d === "inperson" || d === "remote"))
        }
      />
      <Switch
        label="Has a scheduled time"
        checked={f.scheduledOnly}
        onchange={(on) => set("scheduledOnly", on)}
        class="mt-2 w-full justify-between"
      />
    </RailSection>
  </RailGroup>
{/if}

{#if signedIn && fceAvailable}
  <RailGroup title="Workload and ratings">
    <FilterSlider
      label="FCE hours a week, at most"
      help={FCE_HOURS_HELP}
      range={MAX_HOURS_RANGE}
      anyAt="max"
      value={f.maxHours}
      format={(v) => `${v} hrs`}
      onchange={(v) => set("maxHours", v)}
    />
    <FilterSlider
      label="Course rating, at least"
      help="Overall course rating from FCEs, 1 to 5"
      range={MIN_RATING_RANGE}
      anyAt="min"
      value={f.minRating}
      format={(v) => v.toFixed(1)}
      onchange={(v) => set("minRating", v)}
    />
    <Switch
      label="No heavier than its units"
      checked={f.withinUnits}
      onchange={(on) => set("withinUnits", on)}
      class="w-full justify-between"
    />
  </RailGroup>

{/if}

{#if signedIn && fceAvailable && cards}
  <RailGroup title="Aggregate FCEs">
    <FceAggregateSettings />
  </RailGroup>
{/if}

{#if sections}
  <RailGroup title="Other semesters">
    <Switch
      label="Show courses not offered in {termName}"
      checked={query.unoffered}
      onchange={(on) => onchange({ ...query, unoffered: on })}
      class="w-full justify-between text-left"
    />
  </RailGroup>
{/if}
