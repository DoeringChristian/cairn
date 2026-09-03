"""Source contracts for the public cairn-plot card integration."""

from pathlib import Path


ROOT = Path(__file__).parents[2]
CARD = ROOT / "cairn/ui/src/components/CairnPlotCard.tsx"
SHELL = ROOT / "cairn/ui/src/components/CardShell.tsx"
RESIZE = ROOT / "cairn/ui/src/components/CardResizeHandle.tsx"
CSS = ROOT / "cairn/ui/src/index.css"
FIGURE = ROOT / "cairn/ui/src/components/FigureInteractiveCard.tsx"
SCALAR = ROOT / "cairn/ui/src/components/ScalarPlotCard.tsx"
MIN_SIZES = ROOT / "cairn/ui/src/components/card-kit/card-min-sizes.ts"
POLICY = ROOT / "cairn/ui/src/components/card-kit/plot-card-policy.ts"
BASELINE_PICKER = ROOT / "cairn/ui/src/components/card-kit/ExternalBaselinePicker.tsx"
REFERENCE_DROP = ROOT / "cairn/ui/src/components/card-kit/use-reference-drop.ts"


def test_plot_card_uses_stable_public_host_and_bounded_surface() -> None:
    source = CARD.read_text()
    assert 'mountPlot,' in source
    assert 'from "@cairn-plot"' in source
    assert 'autoHeight: false' in source
    assert 'className="h-full min-h-0 min-w-0 overflow-hidden"' in source
    assert 'gap: "0.75rem"' in source
    assert 'rowHeights: ["minmax(0, 1fr)"]' in source
    css = CSS.read_text()
    assert "cairn-card-plot-host > [data-plot-layout-frame]" in css
    assert "[data-plot-layout-frame] > [data-cairn-grid-root]" in css
    assert "@cairn-plot/" not in source


def test_selected_cairn_plot_pane_has_an_embedding_visible_outline() -> None:
    css = CSS.read_text()
    assert '.cairn-card-plot-host [data-plot-pane-id][data-selected="true"]::after' in css
    assert "pointer-events: none" in css
    assert "border: 2px solid var(--color-accent, #0969da)" in css
    assert '[data-reference="true"]::after' in css


def test_plot_card_exposes_persisted_image_controls_and_iteration_slider() -> None:
    source = CARD.read_text()
    for label in (
        'label="Encoding"',
        'label="Exposure"',
        'label="Offset"',
        'label="Peak (HDR ceiling)"',
        'label="Channel reduction"',
        'label="Range minimum"',
        'label="Range maximum"',
        'label="Information panel"',
    ):
        assert label in source
    assert "initialSession:" in source
    assert "patchSettings" in source
    assert "plotSettings?: PlotSettingValues" in source
    assert "<StepSlider" in source
    assert "resolveAtStep(artifactPoints[index] ?? [], currentStep)" in source
    assert "sliderStep?: number" in source
    assert "holdPreviousWhileLoading: true" in source
    assert 'title="Chart viewport"' not in source
    assert '"chart.domainX"' not in source
    assert '"chart.domainY"' not in source


def test_settings_can_select_a_card_comparison_without_dragging() -> None:
    source = CARD.read_text()
    assert "comparisonMetric?: ComparisonSeriesRef" in source
    assert 'title="Compare with"' in source
    assert "<ExternalBaselinePicker" in source
    assert "availableRunIds={availableRunIds}" not in source
    assert 'kind: "compare"' in source
    assert 'referenceMode?: "global" | "per-run"' not in source
    assert 'label="Reference mode"' not in source
    assert 'One global reference' not in source
    assert "const referencePoints = referenceArtifactPoints[index] ?? []" in source
    assert "Each image pane uses that tag from its own run." in source
    assert "const isReferencePane = item?.name === comparisonMetric.name" in source
    picker = BASELINE_PICKER.read_text()
    assert "availableRunIds" not in picker
    assert "pickedRunId" not in picker
    assert "selectedRunId" not in picker
    assert not REFERENCE_DROP.exists()
    assert "referenceArtifactPoints[index]" in source
    assert "operands: [referenceData, data]" in source
    assert 'presentation: selectedCompareOperation === "split" ? "split" : "difference"' in source
    assert 'label="Comparison mode"' not in source
    assert 'label="Diff mode"' in source
    assert '["split", "Split"]' in source
    assert "comparisonOperationSettingsPatch({" in source
    assert 'currentEncoding: typeof live["image.encoding"] === "string"' in source
    assert 'label="Pin reference step"' in source
    assert 'settings.comparisonPresentation === "split"' in source
    assert ': settings.comparisonOperation ?? "absolute"' in source
    assert "use-reference-drop" not in source


def test_card_shell_clips_content_and_resize_persists_only_on_release() -> None:
    # Clip the plot body, not CardShell itself: the latter would also clip the
    # fixed detail modal, menus, and resize handle.
    assert 'className="mt-2 min-h-0 min-w-0 flex-1 overflow-hidden"' in CARD.read_text()
    assert "flex-col overflow-hidden" not in SHELL.read_text()
    source = RESIZE.read_text()
    move = source[source.index("const onPointerMove"):source.index("const onPointerUp")]
    release = source[source.index("const onPointerUp"):source.index('window.addEventListener("pointermove"')]
    assert "onColSpanChange(" not in move
    assert "scheduleResize()" in move
    assert "onColSpanChange(currentSpan)" in release


def test_scalar_and_plotly_features_use_supported_public_surfaces() -> None:
    scalar = SCALAR.read_text()
    for feature in ("EMA smoothing", 'label="X axis"', 'label="Y scale"', 'label="Line type"', "Show legend", "Tooltip: context"):
        assert feature in scalar
    assert "promotedSeries" not in scalar
    assert 'from "@cairn-plot/scalar"' in scalar

    figure = FIGURE.read_text()
    for feature in ("<StepSlider", "MultiPaneGrid", "Overlay (merged)", "Show modebar", "Scroll to zoom", "Hover mode", "Drag mode", "Show legend"):
        assert feature in figure
    assert '<CardShell cardKind="figure"' in figure
    assert 'from "@cairn-plot/figure"' in figure
    assert "@cairn-plot/lib/" not in figure


def test_interactive_plot_sizing_supports_four_columns() -> None:
    sizes = MIN_SIZES.read_text()
    assert "[1, 2, 3, 4, 6]" in sizes
    policy = POLICY.read_text()
    assert 'return { colSpan: 4, defaultHeight: 400 }' in policy
    assert 'return { colSpan: 3, defaultHeight: 300 }' in policy
    assert "VALID_CARD_SPANS" in RESIZE.read_text()


def test_plot_interactions_do_not_rebuild_spec_or_persist_every_slider_event() -> None:
    source = CARD.read_text()
    assert "queryDataKey = allQueries.map" in source
    spec_dependencies = source[source.index("eslint-disable-next-line react-hooks/exhaustive-deps"):source.index("const handleSessionChange")]
    assert "queryDataKey" in spec_dependencies
    assert ", queries," not in spec_dependencies
    patch = source[source.index("const patchPlotSettings"):source.index("const plot = spec")]
    assert "schedulePlotSettingsPersist(next)" in patch
    assert "updateSettings({ plotSettings: next })" not in patch
    assert "updateSettings({ plotSettings: persistedPlotSettingsRef.current })" in source
