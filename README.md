# Visualizing Freshwater Consumption of LLM Inference & Training
Project draft

Date: 2025-11-10

## Abstract
This project visualizes the freshwater consumption associated with large language model (LLM) inference and training by animating how fast a 10 × 10 × 10 m pool fills with water. The goal is to translate abstract metrics into an intuitive, tangible volume and rate so viewers can better grasp the scale of water use by modern machine learning infrastructure. The visualization uses WebGL to render a realistic pool and control flows that map published water-use estimates (from "How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of LLM Inference" : arXiv:2505.09598v2) into per-second fill rates, letting users compare models and scenarios interactively. 

## Motivation
Discussions about AI environmental impacts often center on energy and carbon but overlook freshwater. Cooling data centers, producing electricity, and hardware manufacturing all contribute to water use. Water is a visceral resource. Visualizing it as an everyday object (a pool) makes the abstract concrete. A 10 × 10 × 10 m pool (1,000 m³ = 1,000,000 L) is large but still relatable: showing how quickly it fills gives immediate intuition about cumulative water costs of inference traffic or of training runs.

## Key Concepts and Conversion Framework
- Pool volume:
  - Volume of pool = 10 m × 10 m × 10 m = 1,000 m³ = 1,000,000 L.
- Convert reported water use to visualization:
  - Let winf = water per inference (L/inference).
  - Let qps = queries per second (inferences/s).
  - Fill rate R (L/s) = winf × qps.
  - Time to fill the pool T = Vpool / R seconds.
- For training jobs:
  - Wtrain = total water used for a training run (L).
  - If you want an equivalent steady fill rate, you may divide Wtrain by the real elapsed wall-clock training time to get L/s and animate the pool accordingly, or just show the single-shot effect (e.g., "this training run fills X% of the pool").
- Examples (illustrative only . numbers must be replaced with measured estimates from the literature or instrumentation):
  - If winf = 0.01 L/inference and qps = 100 → R = 1 L/s → T ≈ 11.6 days to fill 1,000,000 L.
  - If a training job uses Wtrain = 50,000 L over 5 days (432,000 s) → average Rtrain ≈ 0.116 L/s.

Note: precise numeric examples in the final report must be derived from the referenced paper and other sources. This draft leaves placeholders where the authoritative estimates will be inserted.

## Literature & Data Sources
The primary reference is "How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of LLM Inference" (arXiv:2505.09598v2). Additional sources that should be consulted:
- Data center cooling water-intensity reports from major cloud providers.
- Case studies and telemetry from on-premise GPU clusters, where available.
- Regional water stress indices to contextualize local impacts (optional).
Peer input is requested to identify any additional high-quality references or raw datasets to improve accuracy.

## Visualization Design
Goals:
- Make rate and cumulative volume clear and intuitive.
- Support scenario comparison (model A vs B; inference vs training; geographic water stress).
- Maintain accessibility and clarity at multiple scales (quick glance vs deep dive).

Core UI elements:
- 3D pool rendered with WebGL (reflective surface, animated waves) and a visible water level that rises as liters accumulate.
- Numeric readouts: instantaneous fill rate (L/s), cumulative liters, percent of pool filled, time-to-fill estimate.
- Scenario controls: choose model, workload (qps), duration, and water-per-op estimate (with default values from literature).
- Comparison mode: side-by-side pools or a split view showing relative speed.
- Time controls: play/pause, accelerate, rewind; ability to simulate finite training jobs or continuous inference traffic.
- Annotation overlays: show source and assumptions for the current scenario (e.g., "winf = X L/inference, derived from [citation]").
- Accessibility: colorblind-safe palette, large numeric labels, keyboard controls, and ARIA-friendly components.

Interaction affordances:
- Preset scenarios (e.g., "small model, 1M q/day", "GPT-scale inference at 100 q/s", "single training run").
- Upload a trace (CSV of qps over time) to animate a realistic traffic profile.
- Export numeric outputs and a shareable permalink of a chosen configuration.

## Implementation Overview
- Stack: React + TypeScript for UI; three.js (or regl) for WebGL rendering; GLSL fragment and vertex shaders for water surface and reflection; lightweight state management (e.g., Zustand or Redux).
- File/feature layout (high level):
  - /src/components/PoolRenderer.tsx : WebGL scene and water shader wrapper.
  - /src/components/Controls.tsx : scenario controls & presets.
  - /src/utils/conversions.ts : authoritative conversion functions (with unit tests).
  - /data/presets.json : curated model/water-use presets (sourced from literature).
- Performance:
  - Keep mesh complexity moderate; animate height via shader uniform rather than re-meshing every frame.
  - Use requestAnimationFrame and cap render updates to visible changes.
- Reproducibility:
  - All scenario presets and conversion code are deterministic and unit-tested.
  - A JSON share-string encodes a full scenario for permalinks.
